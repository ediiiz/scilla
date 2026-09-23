import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  cli,
  gitFixture,
  manifestFile,
  plant,
  removeTemps,
  skillAt,
  temp,
} from "./testing/harness.ts";

afterAll(removeTemps);

const head = (dir: string) =>
  execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir }).toString().trim();

const short = (dir: string) => head(dir).slice(0, 7);

describe("outdated for installed Collections", () => {
  test("is up to date right after an install, then lists what an update would change", async () => {
    const repo = gitFixture({
      ...manifestFile("kit"),
      ...skillAt("skills/alpha", "alpha"),
      ...skillAt("skills/beta", "beta"),
      ...skillAt("skills/same", "same"),
    });

    const project = (await cli(["add", repo.url, "-y"])).io.cwd;
    const before = short(repo.dir);

    expect(await cli(["outdated"], { cwd: project })).toMatchObject({
      code: 0,
      stdout: `kit (${repo.url}) at ${before}: up to date\nEverything is up to date.\n`,
    });

    repo.commit(
      {
        "skills/alpha/SKILL.md": "---\nname: alpha\ndescription: changed\n---\n",
        ...skillAt("skills/gamma", "gamma"),
      },
      ["skills/beta"],
    );

    const after = short(repo.dir);
    const result = await cli(["outdated"], { cwd: project });

    expect(result.code).toBe(10);
    expect(result.stdout).toBe(
      [
        `kit (${repo.url})  ${before} → ${after}`,
        "  Skill  Change              Installed  Upstream",
        `  alpha  changed             ${before}    ${after}`,
        `  beta   removed             ${before}    --`,
        `  gamma  new                 --         ${after}`,
        `  same   moved (same files)  ${before}    ${after}`,
        "Read the changes with scilla diff, then install them with scilla update.",
        "",
      ].join("\n"),
    );
  });

  test("moves alone are not outdated", async () => {
    const repo = gitFixture({ ...manifestFile("kit"), ...skillAt("skills/alpha", "alpha") });
    const project = (await cli(["add", repo.url, "-y"])).io.cwd;

    repo.commit({ "README.md": "unrelated" });

    const result = await cli(["outdated"], { cwd: project });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("moved (same files)");
    expect(result.stdout).toEndWith("Everything is up to date.\n");
  });

  test("with nothing installed", async () => {
    expect(await cli(["outdated"])).toMatchObject({
      code: 0,
      stdout: "No Collections installed.\n",
    });
  });
});

/** A Collection in a folder whose one Reference was reviewed at its first commit, then moved on. */
const reviewedCollection = () => {
  const upstream = gitFixture(skillAt("up", "up"));
  const reviewed = head(upstream.dir);
  const floating = gitFixture(skillAt("float", "float"));

  upstream.commit({ "up/SKILL.md": "---\nname: up\ndescription: newer\n---\n" });

  const dir = plant(temp("collection"), {
    ...manifestFile("Kit", { references: [upstream.url, floating.url] }),
    ...skillAt("skills/own", "own"),
    "scilla-review.json": JSON.stringify({
      version: 1,
      references: { [upstream.url]: { commit: reviewed } },
    }),
  });

  return { upstream, reviewed, floating, dir };
};

describe("outdated inside a Collection", () => {
  test("compares each Reference with its reviewed commit, and exits 10 when one moved", async () => {
    const { upstream, reviewed, floating, dir } = reviewedCollection();
    const result = await cli(["outdated"], { cwd: dir });
    const now = short(upstream.dir);
    const was = reviewed.slice(0, 7);

    expect(result.code).toBe(10);
    expect(result.stdout).toContain(
      'Collection "Kit": each Reference against its reviewed commit\n',
    );
    expect(result.stdout).toMatch(new RegExp(`  \\S+\\s+outdated  ${was}  +${now}\\n`));
    expect(result.stdout).toMatch(
      new RegExp(`  ${floating.url}\\s+floating  --  +${short(floating.dir)}\\n`),
    );
    expect(result.stdout).toContain("Skills a review would release:\n");
    expect(result.stdout).toMatch(
      new RegExp(`  up     changed  ${upstream.url}  ${was}  +${now}\\n`),
    );
    expect(result.stdout).toEndWith("then release them with scilla review accept.\n");

    const accepted = await cli(["review", "accept"], { cwd: dir });

    expect(accepted.stdout).toContain(`Reviewed ${upstream.url}: ${was} → ${now}\n`);
    expect(accepted.stdout).toContain(
      `Reviewed ${floating.url}: floating → ${short(floating.dir)}\n`,
    );
    expect(await cli(["outdated"], { cwd: dir })).toMatchObject({ code: 0 });
    expect((await cli(["outdated"], { cwd: dir })).stdout).toEndWith(
      "Every reviewed Reference is at its reviewed commit.\n",
    );
  });

  test("-g still looks at the installed Collections", async () => {
    const { dir } = reviewedCollection();

    expect(await cli(["outdated", "-g"], { cwd: dir })).toMatchObject({
      code: 0,
      stdout: "No Collections installed.\n",
    });
  });

  test("an unreachable Reference warns, and a Collection with only local ones has none", async () => {
    const missing = `file://${temp("gone")}/nothing`;
    const dir = plant(temp("collection"), manifestFile("Kit", { references: [missing] }));
    const result = await cli(["outdated"], { cwd: dir });

    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/unreachable {2}-- {8}--/);
    expect(result.stderr).toContain(`warning: Reference "${missing}": Can't fetch`);

    const local = plant(temp("collection"), manifestFile("Local"));

    expect((await cli(["outdated"], { cwd: local })).stdout).toStartWith(
      'Collection "Local" has no fetched References to review.\n',
    );
  });
});
