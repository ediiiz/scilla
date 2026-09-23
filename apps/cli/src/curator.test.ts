import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { SCHEMA_URL } from "./schema.ts";
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

const manifestIn = (dir: string) => JSON.parse(readFileSync(join(dir, "scilla.json"), "utf8"));

describe("init", () => {
  test("names the Collection after the directory by default", async () => {
    const cwd = temp("curator");
    const result = await cli(["init"], { cwd });

    expect(result.code).toBe(0);
    expect(result.stdout).toBe(`Created ${join(cwd, "scilla.json")}\n`);
    expect(Object.keys(manifestIn(cwd))[0]).toBe("$schema");
    expect(manifestIn(cwd)).toEqual({
      $schema: SCHEMA_URL,
      name: basename(cwd),
      description: `The ${basename(cwd)} Collection of agent skills.`,
      references: [],
    });
  });

  test("takes --name and --description", async () => {
    const cwd = temp("curator");

    await cli(["init", "--name", "svelte", "--description", "Svelte skills."], { cwd });

    expect(manifestIn(cwd)).toMatchObject({ name: "svelte", description: "Svelte skills." });
  });

  test("refuses when scilla.json exists", async () => {
    const cwd = plant(temp("curator"), manifestFile("kit"));
    const result = await cli(["init"], { cwd });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("already exists");
  });
});

describe("ref add", () => {
  test("appends the string form when there are no options", async () => {
    const cwd = plant(temp("curator"), manifestFile("kit"));
    const result = await cli(["ref", "add", "owner/repo", "--no-verify"], { cwd });

    expect(result.stdout).toBe("Added Reference owner/repo\n");
    expect(result.stderr).toBe("");
    expect(manifestIn(cwd).references).toEqual(["owner/repo"]);
  });

  test("appends the object form with filters", async () => {
    const cwd = plant(temp("curator"), manifestFile("kit"));

    await cli(
      [
        "ref",
        "add",
        "owner/repo",
        "--optional",
        "--include",
        "a*",
        "--exclude",
        "b",
        "--no-verify",
      ],
      { cwd },
    );
    await cli(["ref", "add", "owner/other", "--exclude", "b", "--no-verify"], { cwd });

    expect(manifestIn(cwd).references).toEqual([
      { source: "owner/repo", include: ["a*"], exclude: ["b"], optional: true },
      { source: "owner/other", exclude: ["b"] },
    ]);
  });

  test("refuses a duplicate and a directory that isn't a Collection", async () => {
    const cwd = plant(temp("curator"), manifestFile("kit", { references: ["owner/repo"] }));

    expect((await cli(["ref", "add", "owner/repo"], { cwd })).stderr).toContain("already has");
    expect((await cli(["ref", "add", "owner/repo"])).stderr).toContain("run `scilla init` first");
  });
});

describe("ref add checks its source", () => {
  test("refuses a local path that doesn't exist", async () => {
    const cwd = plant(temp("curator"), manifestFile("kit"));
    const result = await cli(["ref", "add", "./gone"], { cwd });

    expect(result).toMatchObject({
      code: 1,
      stdout: "",
      stderr: `error: Local path ${join(cwd, "gone")} does not exist.\n`,
    });
    expect(manifestIn(cwd).references).toBeUndefined();
  });

  test("adds a local path or a git repo that answers without a warning", async () => {
    const cwd = plant(temp("curator"), { ...manifestFile("kit"), ...skillAt("vendor/a", "a") });
    const repo = gitFixture(skillAt("skills/b", "b"));
    const local = await cli(["ref", "add", "./vendor"], { cwd });
    const pinned = await cli(["ref", "add", `${repo.url}#main`], { cwd });

    expect([local.stderr, pinned.stderr]).toEqual(["", ""]);
    expect(manifestIn(cwd).references).toEqual(["./vendor", `${repo.url}#main`]);
  });

  test("warns about a repo or Pin that doesn't answer, but still adds it", async () => {
    const cwd = plant(temp("curator"), manifestFile("kit"));
    const repo = gitFixture(skillAt("skills/b", "b"));
    const bad = `file://${temp("empty")}/nope`;
    const unreachable = await cli(["ref", "add", bad], { cwd });
    const unpinned = await cli(["ref", "add", `${repo.url}#nope`], { cwd });

    expect(unreachable.code).toBe(0);
    expect(unreachable.stderr).toMatch(
      /^warning: Can't reach file:\/\/\S+: git ls-remote failed: fatal: [^\n]+ Added it anyway; pass --no-verify to skip this check\.\n$/,
    );
    expect(unpinned.stderr).toBe(
      `warning: Pin "nope" not found in ${repo.url}. Added it anyway; pass --no-verify to skip this check.\n`,
    );
    expect(manifestIn(cwd).references).toEqual([bad, `${repo.url}#nope`]);
  });

  test("--no-verify skips the check", async () => {
    const cwd = plant(temp("curator"), manifestFile("kit"));
    const bad = `file://${temp("empty")}/nope`;
    const result = await cli(["ref", "add", bad, "--no-verify"], { cwd });

    expect(result).toMatchObject({ code: 0, stderr: "" });
  });
});

describe("skill new", () => {
  test("scaffolds an Own Skill", async () => {
    const cwd = temp("curator");
    const result = await cli(["skill", "new", "my-skill"], { cwd });
    const file = join(cwd, "skills", "my-skill", "SKILL.md");

    expect(result.stdout).toBe(`Created ${file}\n`);
    expect(existsSync(file)).toBe(true);
  });

  test("refuses a bad name", async () => {
    const result = await cli(["skill", "new", "Bad Name"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("must be lowercase");
  });
});

describe("check", () => {
  test("prints the tree grouped by where each skill came from", async () => {
    const deeper = plant(temp("deeper"), skillAt("skills/deep", "deep"));
    const nested = plant(temp("nested"), manifestFile("inner", { references: [deeper] }));

    const plain = plant(temp("plain"), {
      ...skillAt("tools/runner", "runner"),
      "tools/runner/go.sh!": "#!/bin/sh\n",
    });

    const cwd = plant(temp("curator"), {
      ...manifestFile("kit", { references: [nested, plain], optional: ["runner"] }),
      ...skillAt("skills/own", "own"),
    });

    const result = await cli(["check"], { cwd });

    expect(result.code).toBe(0);
    expect(result.stdout).toBe(
      [
        'Collection "kit": About kit.',
        "Own Skills",
        `  own  ${cwd}/skills/own@local`,
        "inner",
        `  deep  ${deeper}/skills/deep@local via ${deeper}`,
        plain,
        `  runner  ${plain}/tools/runner@local (optional) (executables: tools/runner/go.sh)`,
        "3 skill(s)",
        "",
      ].join("\n"),
    );
  });

  test("takes a directory and prints warnings", async () => {
    const dir = plant(temp("curator"), manifestFile("kit", { references: ["./gone"] }));
    const result = await cli(["check", dir]);

    expect(result.stdout).toContain("0 skill(s)");
    expect(result.stderr).toContain('warning: Reference "./gone" skipped');
  });

  test("git's full stderr follows a one-line warning only with SCILLA_DEBUG", async () => {
    const bad = `file://${temp("empty")}/nope`;
    const dir = plant(temp("curator"), manifestFile("kit", { references: [bad] }));
    const quiet = await cli(["check", dir]);
    const loud = await cli(["check", dir], { debug: true });

    expect(quiet.stderr).toMatch(
      /^warning: Reference "\S+" skipped: Can't fetch \S+: git clone failed: fatal: [^\n]+\n$/,
    );
    expect(loud.stderr).toStartWith(quiet.stderr);
    expect(loud.stderr.slice(quiet.stderr.length)).toMatch(/^(( {2}.*)?\n){2,}$/);
    expect(loud.stderr).toContain("  fatal: ");
  });

  test("a directory without scilla.json is an error", async () => {
    const result = await cli(["check"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("is not a Collection");
  });

  test("a ManifestError exits 1", async () => {
    const cwd = plant(temp("curator"), {
      ...manifestFile("kit", { references: ["./other"] }),
      ...skillAt("skills/same", "same"),
      ...skillAt("other/same", "same"),
    });

    const result = await cli(["check"], { cwd });

    expect(result.code).toBe(1);
    expect(result.stderr).toStartWith('error: Collection "kit": skill "same" comes from both');
  });
});
