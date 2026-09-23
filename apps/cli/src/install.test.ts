import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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

const lockOf = (base: string) => JSON.parse(readFileSync(join(base, "scilla-lock.json"), "utf8"));

const installed = (base: string, name: string) =>
  existsSync(join(base, ".agents", "skills", name, "SKILL.md"));

/** A local Collection "kit": alpha, an optional extra, and tool with an executable script. */
const kit = (name = "kit") =>
  plant(temp("kit"), {
    ...manifestFile(name, { optional: ["extra"] }),
    ...skillAt("skills/alpha", "alpha"),
    ...skillAt("skills/extra", "extra"),
    ...skillAt("skills/tool", "tool"),
    "skills/tool/run.sh!": "#!/bin/sh\necho hi\n",
  });

describe("add", () => {
  test("without a terminal installs the recommended skills and warns about executables", async () => {
    const source = kit();
    const result = await cli(["add", source]);
    const project = result.io.cwd;

    expect(result.code).toBe(0);
    expect(result.plans).toHaveLength(0);
    expect(result.stdout).toContain(`kit (${source}) at local`);
    expect(result.stdout).toContain("Installed: alpha, tool");
    expect(result.stderr).toContain("warning: tool contains executable files: skills/tool/run.sh");
    expect(installed(project, "alpha")).toBe(true);
    expect(installed(project, "extra")).toBe(false);
    expect(Object.keys(lockOf(project).skills)).toEqual(["alpha", "tool"]);
    expect(existsSync(join(project, "skills-lock.json"))).toBe(true);
  });

  test("names at most 5 executables in the warning", async () => {
    const scripts = Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => [
        `skills/big/s${String(index).padStart(2, "0")}.sh`,
        "",
      ]),
    );

    const source = plant(temp("kit"), {
      ...manifestFile("big"),
      ...skillAt("skills/big", "big"),
      ...scripts,
    });

    const { stderr } = await cli(["add", source]);

    expect(stderr).toContain(
      "warning: big contains executable files: skills/big/s00.sh, skills/big/s01.sh, " +
        "skills/big/s02.sh, skills/big/s03.sh, skills/big/s04.sh, +7 more\n",
    );
  });

  test("--all installs optional skills too", async () => {
    const result = await cli(["add", kit(), "--all"]);

    expect(result.stdout).toContain("Installed: alpha, extra, tool");
  });

  test("on a terminal the picker decides", async () => {
    const result = await cli(["add", kit()], {
      interactive: true,
      pickSkills: () => Promise.resolve(new Set(["extra"])),
    });

    expect(result.plans).toHaveLength(1);
    expect(result.plans[0]?.choices.map((choice) => [choice.skill.name, choice.selected])).toEqual([
      ["alpha", true],
      ["extra", false],
      ["tool", true],
    ]);
    expect(result.stdout).toContain("Installed: extra");
    expect(result.stderr).not.toContain("executable");
    expect(installed(result.io.cwd, "alpha")).toBe(false);
  });

  test("a cancelled pick changes nothing", async () => {
    const result = await cli(["add", kit()], {
      interactive: true,
      pickSkills: () => Promise.resolve(undefined),
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toBe("Cancelled.\n");
    expect(existsSync(join(result.io.cwd, "scilla-lock.json"))).toBe(false);
  });

  test("--yes keeps the picker closed on a terminal", async () => {
    const result = await cli(["add", kit(), "-y"], { interactive: true });

    expect(result.code).toBe(0);
    expect(result.plans).toHaveLength(0);
  });

  test("--global installs into the home directory", async () => {
    const home = temp("home");
    const result = await cli(["add", kit(), "-g"], { home });

    expect(result.code).toBe(0);
    expect(installed(home, "alpha")).toBe(true);
    expect(existsSync(join(home, ".agents", "scilla-lock.json"))).toBe(true);
    expect(installed(result.io.cwd, "alpha")).toBe(false);
  });

  test("~ in a source and in a local Reference means the home it is given", async () => {
    const home = temp("home");

    plant(join(home, "kit"), manifestFile("home-kit", { references: ["~/vendor"] }));
    plant(home, skillAt("vendor/v", "v"));

    const result = await cli(["add", "~/kit"], { home });

    expect(result.stdout).toContain(`home-kit (${home}/kit) at local`);
    expect(result.stdout).toContain("Installed: v");
  });

  test("adding again reports unchanged skills", async () => {
    const source = kit();
    const cwd = temp("project");

    await cli(["add", source], { cwd });

    const again = await cli(["add", source], { cwd });

    expect(again.stdout).toContain("Unchanged: alpha, tool");
  });

  test("Traversal warnings are printed", async () => {
    const source = plant(temp("kit"), {
      ...manifestFile("warned", { references: ["./missing"] }),
      ...skillAt("skills/alpha", "alpha"),
    });

    const result = await cli(["add", source]);

    expect(result.code).toBe(0);
    expect(result.stderr).toContain('warning: Reference "./missing" skipped');
  });

  test("a clash with a skill scilla didn't install is skipped", async () => {
    const cwd = plant(temp("project"), skillAt(".agents/skills/alpha", "alpha"));
    const result = await cli(["add", kit()], { cwd });

    expect(result.stderr).toContain("warning: Skipped alpha: a skill of that name exists");
    expect(result.stdout).not.toContain("alpha");
  });

  test("an unreadable source is an error", async () => {
    const result = await cli(["add", "not a source"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toStartWith("error: Can't read source");
  });
});

const remote = () => gitFixture({ ...manifestFile("remote-kit"), ...skillAt("skills/one", "one") });

describe("update", () => {
  test("without a terminal keeps selected skills and lists new ones", async () => {
    const repo = remote();
    const cwd = temp("project");

    expect((await cli(["add", repo.url], { cwd })).stdout).toContain("Installed: one");

    repo.commit(skillAt("skills/two", "two"));

    const result = await cli(["update"], { cwd });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Unchanged: one");
    expect(result.stdout).toContain(
      "1 new skill(s) available: two (run scilla update remote-kit to pick)",
    );
    expect(installed(cwd, "two")).toBe(false);

    // Nothing decided about "two", so it is still announced the next time.
    expect((await cli(["update", "--yes"], { cwd })).stdout).toContain(
      "1 new skill(s) available: two",
    );
    expect(lockOf(cwd).collections[repo.url].declined).toEqual([]);
  });

  test("reinstalls changed skills and removes ones gone upstream", async () => {
    const repo = remote();
    const cwd = temp("project");

    repo.commit(skillAt("skills/two", "two"));
    await cli(["add", repo.url], { cwd });
    repo.commit({ "skills/one/notes.md": "more\n" }, ["skills/two"]);

    const result = await cli(["update", "remote-kit", "-y"], { cwd });

    expect(result.stdout).toContain("Updated: one");
    expect(result.stdout).toContain("Removed: two");
    expect(installed(cwd, "two")).toBe(false);
  });

  test("on a terminal the picker marks changed skills and can show their changes", async () => {
    const repo = remote();
    const cwd = temp("project");

    await cli(["add", repo.url], { cwd });
    repo.commit({ "skills/one/notes.md": "more\n" });

    const shown: string[] = [];

    const result = await cli(["update"], {
      cwd,
      interactive: true,
      pickSkills: async (plan, options) => {
        const [one] = plan.choices;

        shown.push(one === undefined ? "" : await (options?.diff?.(one) ?? ""));

        return new Set(["one"]);
      },
    });

    expect(result.plans[0]?.choices.map((choice) => [choice.skill.name, choice.changed])).toEqual([
      ["one", true],
    ]);
    expect(shown[0]).toContain("+more\n");
    expect(result.stdout).toContain("Updated: one");
  });

  test("on a terminal the picker can opt into new skills", async () => {
    const repo = remote();
    const cwd = temp("project");

    await cli(["add", repo.url], { cwd });
    repo.commit(skillAt("skills/two", "two"));

    const result = await cli(["update"], {
      cwd,
      interactive: true,
      pickSkills: () => Promise.resolve(new Set(["one", "two"])),
    });

    expect(result.plans[0]?.choices.map((choice) => choice.status)).toEqual(["installed", "new"]);
    expect(result.stdout).toContain("Installed: two");
    expect(result.stdout).not.toContain("new skill(s) available");
  });

  test("a cancelled pick stops the update", async () => {
    const cwd = temp("project");

    await cli(["add", remote().url], { cwd });

    const result = await cli(["update"], {
      cwd,
      interactive: true,
      pickSkills: () => Promise.resolve(undefined),
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toBe("Cancelled.\n");
  });

  test("updates every installed Collection in turn", async () => {
    const cwd = temp("project");
    const local = kit("My Kit");

    await cli(["add", remote().url], { cwd });
    await cli(["add", local], { cwd });
    plant(local, skillAt("skills/late", "late"));

    const result = await cli(["update", "--yes"], { cwd });

    expect(result.stdout).toContain("remote-kit (");
    expect(result.stdout).toContain(
      '1 new skill(s) available: late (run scilla update "My Kit" to pick)',
    );
    expect(Object.keys(lockOf(cwd).collections)).toHaveLength(2);
  });

  test("local edits are kept unless --force", async () => {
    const repo = remote();
    const cwd = temp("project");

    await cli(["add", repo.url], { cwd });
    writeFileSync(join(cwd, ".agents", "skills", "one", "SKILL.md"), "edited\n");
    repo.commit({ "skills/one/notes.md": "more\n" });

    const kept = await cli(["update"], { cwd });

    expect(kept.stdout).not.toContain("Skipped");
    expect(kept.stderr).toContain("warning: Skipped one: has local edits");

    const forced = await cli(["update", "--force"], { cwd });

    expect(forced.stdout).toContain("Updated: one");
  });

  test("nothing installed", async () => {
    expect((await cli(["update"])).stdout).toBe("No Collections installed.\n");
  });

  test("an unknown Collection is an error", async () => {
    const result = await cli(["update", "nope"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toBe('error: Collection "nope" is not installed.\n');
  });
});
