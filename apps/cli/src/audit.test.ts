import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AuditFetch } from "@scilla/core";
import { auditTable, unauditedLine } from "./audit.ts";
import {
  cli,
  githubCache,
  gitFixture,
  manifestFile,
  plant,
  removeTemps,
  skillAt,
  temp,
} from "./testing/harness.ts";

afterAll(removeTemps);

type Rating = Readonly<Record<string, { readonly risk: string; readonly alerts?: number }>>;

/**
 * A fake network: GitHub says `owner/repo` is public (or private), and the audit service answers
 * with `ratings`. Every requested URL is recorded.
 */
const network = (ratings: Readonly<Record<string, Rating>>, isPrivate = false) => {
  const requests: string[] = [];

  const fetch: AuditFetch = (url) => {
    requests.push(url);

    if (url.startsWith("https://api.github.com/repos/")) {
      return Promise.resolve(Response.json({ private: isPrivate }));
    }

    return Promise.resolve(Response.json(ratings));
  };

  return { fetch, requests };
};

const SAFE = { ath: { risk: "safe" }, socket: { risk: "safe", alerts: 0 }, snyk: { risk: "low" } };

const RISKY = { ath: { risk: "medium" }, socket: { risk: "high", alerts: 3 } };

/** `acme/kit` on "GitHub": a Collection with the skills `good` and `bad`. */
const kit = () => {
  const repo = gitFixture({
    ...manifestFile("Kit"),
    ...skillAt("skills/good", "good"),
    ...skillAt("skills/bad", "bad"),
  });

  return githubCache("acme/kit", repo.dir);
};

const everything = (plan: {
  readonly choices: readonly { readonly skill: { readonly name: string } }[];
}) => Promise.resolve(new Set(plan.choices.map((choice) => choice.skill.name)));

describe("install-time ratings", () => {
  test("prints the ticked skills' ratings before installing", async () => {
    const cwd = temp("project");
    const { fetch, requests } = network({ good: SAFE, bad: SAFE });
    const result = await cli(["add", "acme/kit", "-y"], { cwd, cacheDir: kit(), fetch });

    expect(result.code).toBe(0);
    expect(requests).toEqual([
      "https://api.github.com/repos/acme/kit",
      "https://add-skill.vercel.sh/audit?source=acme%2Fkit&skills=bad%2Cgood",
    ]);
    expect(result.stdout).toStartWith(
      [
        "Security risk assessments",
        "  Skill  Gen   Socket  Snyk",
        "  bad    safe  safe    low",
        "  good   safe  safe    low",
        "  Details: https://skills.sh/acme/kit",
        "Kit (acme/kit) at ",
      ].join("\n"),
    );
    expect(result.stdout).toContain("Installed: bad, good");
    expect(result.stderr).not.toContain("warning:");
  });

  test("unattended, a risky rating is a warning and the install goes ahead", async () => {
    const cwd = temp("project");
    const { fetch } = network({ bad: RISKY });
    const result = await cli(["add", "acme/kit", "-y"], { cwd, cacheDir: kit(), fetch });

    expect(result.stdout).toContain("  bad    medium  high (3 alerts)  --\n");
    expect(result.stdout).toContain("  1 other skill(s) not audited.\n");
    expect(result.stderr).toContain("warning: Rated medium risk or higher: bad (high)\n");
    expect(result.stdout).toContain("Installed: bad, good");
    expect(result.questions).toEqual([]);
  });

  test("on a terminal, a risky rating asks first, and anything but yes cancels", async () => {
    const cacheDir = kit();
    const { fetch, requests } = network({ bad: RISKY });
    let requestedBeforePick = 0;

    const pickSkills = (plan: Parameters<typeof everything>[0]) => {
      requestedBeforePick = requests.length;

      return everything(plan);
    };

    const no = temp("project");

    const refused = await cli(["add", "acme/kit"], {
      cwd: no,
      cacheDir,
      fetch,
      interactive: true,
      pickSkills,
      ask: () => Promise.resolve("n"),
    });

    // The ratings were already on their way while the picker was open, and it was handed them.
    expect(requestedBeforePick).toBeGreaterThan(0);
    expect(refused.audits).toHaveLength(1);
    expect((await refused.audits[0])?.audits.get("bad")?.worst).toBe("high");
    expect(refused.questions).toEqual([
      "Rated medium risk or higher: bad (high). Proceed with installation? [y/N] ",
    ]);
    expect(refused.stdout).toEndWith("Cancelled.\n");
    expect(existsSync(join(no, ".agents"))).toBe(false);

    const yes = temp("project");

    const accepted = await cli(["add", "acme/kit"], {
      cwd: yes,
      cacheDir,
      fetch,
      interactive: true,
      pickSkills: everything,
      ask: () => Promise.resolve(" Yes "),
    });

    expect(accepted.stdout).toContain("Installed: bad, good");
  });

  test("a safe rating doesn't ask", async () => {
    const { fetch } = network({ good: SAFE, bad: SAFE });

    const result = await cli(["add", "acme/kit"], {
      cacheDir: kit(),
      fetch,
      interactive: true,
      pickSkills: everything,
    });

    expect(result.questions).toEqual([]);
    expect(result.stdout).toContain("Installed: bad, good");
  });

  test("--no-audit, an opt-out variable, or a private repo sends nothing to the audit service", async () => {
    const cacheDir = kit();
    const off = network({ bad: RISKY });
    const optedOut = network({ bad: RISKY });
    const hidden = network({ bad: RISKY }, true);

    await cli(["add", "acme/kit", "-y", "--no-audit"], { cacheDir, fetch: off.fetch });
    await cli(["add", "acme/kit", "-y"], {
      cacheDir,
      fetch: optedOut.fetch,
      env: { DO_NOT_TRACK: "1" },
    });

    const result = await cli(["add", "acme/kit", "-y"], { cacheDir, fetch: hidden.fetch });

    expect(off.requests).toEqual([]);
    expect(optedOut.requests).toEqual([]);
    expect(hidden.requests).toEqual(["https://api.github.com/repos/acme/kit"]);
    expect(result.stdout).not.toContain("Security risk assessments");
    expect(result.stdout).toContain("Installed: bad, good");
  });

  test("a github.com https URL is rated and recorded like the shorthand", async () => {
    const cwd = temp("project");
    const { fetch, requests } = network({ good: SAFE });

    const result = await cli(["add", "https://github.com/acme/kit", "-y"], {
      cwd,
      cacheDir: kit(),
      fetch,
    });

    expect(result.code).toBe(0);
    expect(requests[0]).toBe("https://api.github.com/repos/acme/kit");
    expect(result.stdout).toContain("Kit (acme/kit) at ");

    const lock = JSON.parse(readFileSync(join(cwd, "scilla-lock.json"), "utf8"));
    const skillsLock = JSON.parse(readFileSync(join(cwd, "skills-lock.json"), "utf8"));

    expect(Object.keys(lock.collections)).toEqual(["acme/kit"]);
    expect(skillsLock.skills.good).toMatchObject({ source: "acme/kit", sourceType: "github" });
  });

  test("a lock from before GitHub URLs counted as GitHub still updates, and is migrated", async () => {
    const cwd = temp("project");
    const cacheDir = kit();
    const url = "https://github.com/acme/kit.git";

    await cli(["add", url, "-y", "--no-audit"], { cwd, cacheDir });

    const file = join(cwd, "scilla-lock.json");
    const { collections, skills } = JSON.parse(readFileSync(file, "utf8"));
    const entry = collections["acme/kit"];

    // What an older scilla wrote: `git` kinds, keyed by the URL.
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        collections: { [url]: { ...entry, source: { ...entry.source, kind: "git" } } },
        skills: Object.fromEntries(
          Object.keys(skills).map((name) => [
            name,
            { ...skills[name], kind: "git", collections: [url] },
          ]),
        ),
      }),
    );

    const result = await cli(["update", url, "-y", "--no-audit"], { cwd, cacheDir });
    const migrated = JSON.parse(readFileSync(file, "utf8"));

    expect(result.stdout).toContain("Unchanged: bad, good");
    expect(Object.keys(migrated.collections)).toEqual(["acme/kit"]);
    expect(migrated.skills.good).toMatchObject({ kind: "github", collections: ["acme/kit"] });
  });

  test("a failing network changes nothing", async () => {
    const result = await cli(["add", "acme/kit", "-y"], { cacheDir: kit() });

    expect(result.code).toBe(0);
    expect(result.stdout).not.toContain("Security risk assessments");
    expect(result.stdout).toContain("Installed: bad, good");
  });

  test("update rates the skills it installs", async () => {
    const cwd = temp("project");
    const cacheDir = kit();
    const { fetch } = network({ good: SAFE });

    await cli(["add", "acme/kit", "-y", "--no-audit"], { cwd, cacheDir });

    const result = await cli(["update", "-y"], { cwd, cacheDir, fetch });

    expect(result.stdout).toStartWith("Security risk assessments\n");
    expect(result.stdout).toContain("Unchanged: bad, good");
  });
});

describe("scilla audit", () => {
  test("rates the installed skills; unrated ones show -- and are explained", async () => {
    const cwd = temp("project");
    const cacheDir = kit();
    const local = plant(temp("local"), skillAt("skills/mine", "mine"));

    await cli(["add", "acme/kit", "-y", "--no-audit"], { cwd, cacheDir });
    await cli(["add", local, "-y"], { cwd });

    const { fetch } = network({ good: SAFE });
    const result = await cli(["audit"], { cwd, fetch });

    expect(result.code).toBe(0);
    expect(result.stdout).toBe(
      [
        "Security risk assessments",
        "  Skill  Gen   Socket  Snyk",
        "  bad    --    --      --",
        "  good   safe  safe    low",
        "  mine   --    --      --",
        "  Details: https://skills.sh/acme/kit",
        "Not audited: mine (not from GitHub); bad (no ratings yet).",
        "",
      ].join("\n"),
    );
  });

  test("says why nothing could be audited", async () => {
    const cwd = temp("project");
    const local = plant(temp("local"), skillAt("skills/mine", "mine"));

    await cli(["add", local, "-y"], { cwd });

    expect((await cli(["audit"], { cwd })).stdout).toBe("Not audited: mine (not from GitHub).\n");
    expect((await cli(["audit", "--no-audit"], { cwd })).stdout).toBe(
      "Not audited: mine (ratings are turned off).\n",
    );
  });

  test("a private repo is never named to the audit service", async () => {
    const cwd = temp("project");

    await cli(["add", "acme/kit", "-y", "--no-audit"], { cwd, cacheDir: kit() });

    const { fetch, requests } = network({ good: SAFE }, true);
    const result = await cli(["audit"], { cwd, fetch });

    expect(requests).toEqual(["https://api.github.com/repos/acme/kit"]);
    expect(result.stdout).toBe("Not audited: bad, good (not a public GitHub repo).\n");
  });

  test("with nothing installed", async () => {
    expect((await cli(["audit"])).stdout).toBe("Nothing installed in this project.\n");
    expect((await cli(["audit", "-g"])).stdout).toBe("Nothing installed globally.\n");
  });

  test("reads the global lock with -g", async () => {
    const home = temp("home");

    writeFileSync(
      join(plant(home, { ".agents/.keep": "" }), ".agents", "scilla-lock.json"),
      JSON.stringify({
        version: 1,
        collections: {},
        skills: {
          far: {
            collections: [],
            kind: "git",
            url: "https://gitlab.example.com/a/b.git",
            path: "far",
            commit: "abc",
            computedHash: "x",
            optional: false,
          },
        },
      }),
    );

    expect((await cli(["audit", "-g"], { home })).stdout).toBe(
      "Not audited: far (not from GitHub).\n",
    );
  });
});

describe("the table", () => {
  test("adds a column for each extra provider and a line per details page", () => {
    const audits = new Map([
      [
        "a",
        {
          providers: [
            { id: "ath", label: "Gen", risk: "safe" as const },
            { id: "zeroleaks", label: "ZeroLeaks", risk: "low" as const, score: 90 },
          ],
          worst: "low" as const,
          detailsUrl: "https://skills.sh/o/one",
        },
      ],
      [
        "b",
        {
          providers: [{ id: "newcomer", label: "newcomer", risk: "critical" as const }],
          worst: "critical" as const,
          detailsUrl: "https://skills.sh/o/two",
        },
      ],
    ]);

    expect(auditTable(["a", "b"], audits)).toEqual([
      "Security risk assessments",
      "  Skill  Gen   Socket  Snyk  ZeroLeaks  newcomer",
      "  a      safe  --      --    low        --",
      "  b      --    --      --    --         critical",
      "  Details: https://skills.sh/o/one",
      "  Details: https://skills.sh/o/two",
    ]);
  });

  test("unauditedLine is undefined when everything was audited", () => {
    expect(unauditedLine(new Map())).toBeUndefined();
  });
});
