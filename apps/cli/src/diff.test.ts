import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AuditFetch } from "@scilla/core";
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

const short = (dir: string) =>
  execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { cwd: dir }).toString().trim();

const ALPHA_CHANGED = "---\nname: alpha\ndescription: changed\n---\n";

/** An installed Collection whose upstream then changed alpha (adding a script), added gamma and dropped beta. */
const changedKit = async () => {
  const repo = gitFixture({
    ...manifestFile("kit"),
    ...skillAt("skills/alpha", "alpha"),
    ...skillAt("skills/beta", "beta"),
  });

  const project = (await cli(["add", repo.url, "-y"])).io.cwd;
  const before = short(repo.dir);

  repo.commit(
    {
      "skills/alpha/SKILL.md": ALPHA_CHANGED,
      "skills/alpha/scripts/run.sh": "echo hi\n",
      ...skillAt("skills/gamma", "gamma"),
    },
    ["skills/beta"],
  );

  return { repo, project, before, after: short(repo.dir) };
};

/** GitHub says every repo is public, and the audit service rates `good`. */
const ratings: AuditFetch = (url) =>
  Promise.resolve(
    Response.json(
      url.startsWith("https://api.github.com/")
        ? { private: false }
        : { good: { ath: { risk: "safe" }, snyk: { risk: "medium" } } },
    ),
  );

describe("diff for installed Collections", () => {
  test("shows each changed, new and removed skill with its files and git's diff", async () => {
    const { repo, project, before, after } = await changedKit();
    const result = await cli(["diff"], { cwd: project });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`alpha  changed  ${before} → ${after}  (kit (${repo.url}))\n`);
    expect(result.stdout).toContain(`  from     ${repo.url} skills/alpha\n`);
    expect(result.stdout).toContain("  ⚠ can run code, new or changed: scripts/run.sh (added)\n");
    expect(result.stdout).toContain("  files    M SKILL.md, A scripts/run.sh\n");
    expect(result.stdout).toContain("diff --git a/SKILL.md b/SKILL.md\n");
    expect(result.stdout).toContain("-description: alpha does things.\n+description: changed\n");
    expect(result.stdout).toContain(`beta  removed  ${before} → --`);
    expect(result.stdout).toContain(`gamma  new  -- → ${after}`);
    expect(result.stdout).not.toContain("\u001B[");
  });

  test("narrows to a skill or a Collection, and refuses a name nothing has", async () => {
    const { project } = await changedKit();
    const one = await cli(["diff", "gamma"], { cwd: project });

    expect(one.stdout).toStartWith("gamma  new");
    expect(one.stdout).not.toContain("alpha  changed");
    expect((await cli(["diff", "kit"], { cwd: project })).stdout).toContain("alpha  changed");
    expect(await cli(["diff", "nope"], { cwd: project })).toMatchObject({
      code: 1,
      stderr:
        'error: Nothing called "nope" to diff: no Collection, Reference or skill has that name.\n',
    });
  });

  test("colours the diff on a terminal only", async () => {
    const { project } = await changedKit();
    const styled = await cli(["diff", "alpha"], { cwd: project, tty: true });

    expect(styled.stdout).toContain("\u001B[32m+description: changed\u001B[0m\n");
    expect(styled.stdout).toContain("\u001B[31m-description: alpha does things.\u001B[0m\n");
    expect(
      (await cli(["diff", "alpha", "--raw"], { cwd: project, tty: true })).stdout,
    ).not.toContain("\u001B[");
  });

  test("compares with the locked commit, not local edits, and says when that commit is gone", async () => {
    const { repo, project } = await changedKit();

    writeFileSync(join(project, ".agents", "skills", "alpha", "SKILL.md"), "my own edit\n");

    const result = await cli(["diff", "alpha"], { cwd: project });

    expect(result.stdout).not.toContain("my own edit");
    expect(result.stdout).toContain("-description: alpha does things.\n");

    repo.amend({ "skills/alpha/SKILL.md": ALPHA_CHANGED });

    const gone = gitFixture({ ...manifestFile("gone"), ...skillAt("skills/g", "g") });
    const other = (await cli(["add", gone.url, "-y"])).io.cwd;

    writeFileSync(join(other, ".agents", "skills", "g", "SKILL.md"), "edited\n");
    gone.amend({ "skills/g/SKILL.md": "rewritten\n" });

    const missing = await cli(["diff"], { cwd: other });

    expect(missing.code).toBe(0);
    expect(missing.stderr).toMatch(/warning: Can't diff g: Commit [0-9a-f]{7} is no longer in/);
  });

  test("with nothing to show", async () => {
    const repo = gitFixture({ ...manifestFile("kit"), ...skillAt("skills/alpha", "alpha") });
    const project = (await cli(["add", repo.url, "-y"])).io.cwd;

    repo.commit({ "README.md": "unrelated" });

    expect(await cli(["diff"], { cwd: project })).toMatchObject({
      code: 0,
      stdout: "No changes.\n",
    });
    expect((await cli(["diff", "alpha"], { cwd: project })).stdout).toBe("No changes for alpha.\n");
  });

  test("shows ratings before and after for a public GitHub repo", async () => {
    const repo = gitFixture({ ...manifestFile("Kit"), ...skillAt("skills/good", "good") });
    const cacheDir = githubCache("acme/kit", repo.dir);

    const project = (await cli(["add", "acme/kit", "-y", "--no-audit"], { cacheDir })).io.cwd;

    repo.commit({ "skills/good/SKILL.md": "---\nname: good\ndescription: better\n---\n" });

    const result = await cli(["diff"], { cwd: project, cacheDir, fetch: ratings });

    expect(result.stdout).toContain("  ratings  Gen safe → safe · Snyk medium → medium\n");
    expect(
      (await cli(["diff", "--no-audit"], { cwd: project, cacheDir, fetch: ratings })).stdout,
    ).not.toContain("ratings");
  });
});

describe("diff inside a Collection", () => {
  test("shows what a review would release, per Reference or skill", async () => {
    const upstream = gitFixture(skillAt("up", "up"));
    const reviewed = short(upstream.dir);

    upstream.commit({ "up/SKILL.md": "---\nname: up\ndescription: newer\n---\n" });

    const full = execFileSync("git", ["rev-parse", reviewed], { cwd: upstream.dir })
      .toString()
      .trim();

    const dir = plant(temp("collection"), {
      ...manifestFile("Kit", { references: [upstream.url] }),
      ...skillAt("skills/own", "own"),
      "scilla-review.json": JSON.stringify({
        version: 1,
        references: { [upstream.url]: { commit: full } },
      }),
    });

    const result = await cli(["diff", upstream.url], { cwd: dir });

    expect(result.stdout).toStartWith(
      `up  changed  ${reviewed} → ${short(upstream.dir)}  (Collection "Kit")\n`,
    );
    expect(result.stdout).toContain("+description: newer\n");
    expect((await cli(["diff", "own"], { cwd: dir })).stdout).toBe("No changes for own.\n");
  });
});
