import { afterAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cli, gitFixture, manifestFile, removeTemps, skillAt, temp } from "./testing/harness.ts";

afterAll(removeTemps);

const skillText = (base: string, name: string) =>
  readFileSync(join(base, ".agents", "skills", name, "SKILL.md"), "utf8");

/** A Collection repo with skills alpha and beta, installed into a project with `add -y`. */
const installed = async () => {
  const repo = gitFixture({
    ...manifestFile("kit"),
    ...skillAt("skills/alpha", "alpha"),
    ...skillAt("skills/beta", "beta"),
  });

  const first = await cli(["add", repo.url, "-y"]);

  return { repo, project: first.io.cwd };
};

/** A teammate's fresh checkout of the project: only its scilla-lock.json. */
const checkout = (project: string) => {
  const fresh = temp("teammate");

  copyFileSync(join(project, "scilla-lock.json"), join(fresh, "scilla-lock.json"));

  return fresh;
};

describe("install", () => {
  test("installs the locked commits for a teammate, even after upstream moved", async () => {
    const { repo, project } = await installed();

    repo.commit({ "skills/alpha/SKILL.md": "---\nname: alpha\ndescription: moved on\n---\n" });

    const fresh = checkout(project);
    const result = await cli(["install"], { cwd: fresh });

    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(result.stdout).toBe("Installed: alpha, beta\n");
    expect(skillText(fresh, "alpha")).toContain("alpha does things.");
    expect(readFileSync(join(fresh, "scilla-lock.json"), "utf8")).toBe(
      readFileSync(join(project, "scilla-lock.json"), "utf8"),
    );
    expect(await cli(["install", "--check"], { cwd: fresh })).toMatchObject({
      code: 0,
      stdout: "Everything installed matches scilla-lock.json.\n",
    });
    expect((await cli(["install", "--frozen"], { cwd: fresh })).stdout).toBe(
      "Unchanged: alpha, beta\n",
    );
  });

  test("--check installs nothing and reports what differs", async () => {
    const { project } = await installed();
    const fresh = checkout(project);

    mkdirSync(join(fresh, ".agents", "skills", "stray"), { recursive: true });

    expect(await cli(["install", "--check"], { cwd: fresh })).toMatchObject({
      code: 1,
      stdout: "Missing: alpha, beta\nExtra: stray (in .agents/skills, but in no lock)\n",
      stderr: "error: 3 skill(s) don't match scilla-lock.json.\n",
    });
  });

  test("skips local edits unless --force, and --frozen fails on them", async () => {
    const { project } = await installed();

    writeFileSync(join(project, ".agents", "skills", "alpha", "SKILL.md"), "mine");

    const skipped = await cli(["install"], { cwd: project });

    expect(skipped.code).toBe(0);
    expect(skipped.stdout).toBe("Unchanged: beta\n");
    expect(skipped.stderr).toContain("warning: Skipped alpha: its files differ from the lock");

    expect(await cli(["install", "--frozen"], { cwd: project })).toMatchObject({
      code: 1,
      stdout: "Unchanged: beta\nModified: alpha\n",
      stderr: expect.stringContaining(
        "error: 1 skill(s) don't match scilla-lock.json after the install (--frozen).\n",
      ),
    });

    const forced = await cli(["install", "--force"], { cwd: project });

    expect(forced.stdout).toBe("Updated: alpha\nUnchanged: beta\n");
    expect(skillText(project, "alpha")).toContain("alpha does things.");
  });

  test("a locked commit gone upstream is an error for its skills only", async () => {
    const { repo, project } = await installed();
    const other = gitFixture(skillAt("tool", "tool"));
    const both = (await cli(["add", other.url, "-y"], { cwd: project })).io.cwd;

    other.amend({ "tool/SKILL.md": "rewritten" });

    const result = await cli(["install"], { cwd: checkout(both) });

    expect(repo.url).not.toBe(other.url);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("Installed: alpha, beta\n");
    expect(result.stderr).toMatch(
      /^error: Can't install tool: Commit [0-9a-f]{7} is no longer in file:\S+; was it force-pushed away\?\n$/,
    );
  });

  test("-g restores the home directory's lock", async () => {
    const repo = gitFixture({ ...manifestFile("kit"), ...skillAt("skills/alpha", "alpha") });
    const home = temp("home");

    await cli(["add", repo.url, "-y", "-g"], { home });

    const fresh = temp("home");

    mkdirSync(join(fresh, ".agents"));
    copyFileSync(
      join(home, ".agents", "scilla-lock.json"),
      join(fresh, ".agents", "scilla-lock.json"),
    );

    expect(await cli(["install", "-g"], { home: fresh })).toMatchObject({
      code: 0,
      stdout: "Installed: alpha\n",
    });
  });

  test("with nothing locked there is nothing to do", async () => {
    expect(await cli(["install"])).toMatchObject({
      code: 0,
      stdout: "Nothing to install: no scilla-lock.json with skills in this project.\n",
    });
  });

  test("a source is refused, pointing at add", async () => {
    expect(await cli(["install", "acme/skills"])).toMatchObject({
      code: 1,
      stderr:
        "error: scilla install takes no source: it installs what scilla-lock.json records. To add a Collection, run: scilla add acme/skills\nsee: scilla docs commands\n",
    });
  });
});
