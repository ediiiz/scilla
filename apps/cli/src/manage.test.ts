import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cli, manifestFile, plant, removeTemps, skillAt, temp } from "./testing/harness.ts";

afterAll(removeTemps);

/** A project with Collections "first" (a, shared) and "second" (b, and first's shared) installed. */
const project = async () => {
  const cwd = temp("project");

  const first = plant(temp("kit"), {
    ...manifestFile("first"),
    ...skillAt("skills/a", "a"),
    ...skillAt("skills/shared", "shared"),
  });

  const second = plant(temp("kit"), {
    ...manifestFile("second", { references: [{ source: first, include: ["shared"] }] }),
    ...skillAt("skills/b", "b"),
  });

  await cli(["add", first], { cwd });
  await cli(["add", second], { cwd });

  return { cwd, first, second };
};

const installed = (base: string, name: string) => existsSync(join(base, ".agents", "skills", name));

describe("delete", () => {
  test("a Collection by name keeps skills another Collection installed", async () => {
    const { cwd, first } = await project();
    const result = await cli(["delete", "FIRST"], { cwd });

    expect(result.code).toBe(0);
    expect(result.stdout).toBe(`Deleting Collection first (${first})\nRemoved: a\n`);
    expect(installed(cwd, "a")).toBe(false);
    expect(installed(cwd, "shared")).toBe(true);
  });

  test("a Collection by its source key", async () => {
    const { cwd, second } = await project();
    const result = await cli(["remove", second], { cwd });

    expect(result.stdout).toContain("Removed: b");
  });

  test("one skill is removed and declined", async () => {
    const { cwd, first, second } = await project();
    const result = await cli(["delete", "shared"], { cwd });
    const lock = JSON.parse(readFileSync(join(cwd, "scilla-lock.json"), "utf8"));

    expect(result.stdout).toBe("Deleting skill shared\nRemoved: shared\n");
    expect(lock.collections[first].declined).toEqual(["shared"]);
    expect(lock.collections[second].declined).toEqual(["shared"]);
  });

  test("local edits are kept unless --force", async () => {
    const { cwd } = await project();

    writeFileSync(join(cwd, ".agents", "skills", "a", "SKILL.md"), "edited\n");

    const kept = await cli(["delete", "a"], { cwd });

    expect(kept).toMatchObject({
      stdout: "Deleting skill a\nNothing changed.\n",
      stderr: "warning: Skipped a: has local edits (use --force to overwrite); kept\n",
    });
    expect(installed(cwd, "a")).toBe(true);

    const forced = await cli(["delete", "a", "--force"], { cwd });

    expect(forced.stdout).toContain("Removed: a");
  });

  test("something not installed is an error", async () => {
    const local = await cli(["delete", "ghost"]);
    const global = await cli(["delete", "ghost", "-g"]);

    expect(local.code).toBe(1);
    expect(local.stderr).toBe(
      'error: No Collection or skill "ghost" is installed in this project.\n',
    );
    expect(global.stderr).toContain("installed globally.");
  });
});

describe("list", () => {
  test("Collections with source and commit, then their skills", async () => {
    const { cwd, first, second } = await project();
    const result = await cli(["list"], { cwd });

    const expected = [
      `first  ${first}  local`,
      "  a",
      "  shared",
      `second  ${second}  local`,
      "  b",
      "  shared",
    ];

    // Keys are sorted, and the temp dirs sort in creation order only by chance, so sort to compare.
    expect(result.stdout.split("\n").slice(0, -1).toSorted()).toEqual(expected.toSorted());
  });

  test("skills no Collection claims are listed on their own", async () => {
    const { cwd, first } = await project();
    const file = join(cwd, "scilla-lock.json");
    const lock = JSON.parse(readFileSync(file, "utf8"));

    delete lock.collections[first];
    writeFileSync(file, JSON.stringify(lock));

    const result = await cli(["list"], { cwd });

    expect(result.stdout).toEndWith("Skills in no Collection:\n  a\n");
  });

  test("an empty scope", async () => {
    expect((await cli(["list"])).stdout).toBe("Nothing installed in this project.\n");
    expect((await cli(["list", "-g"])).stdout).toBe("Nothing installed globally.\n");
  });
});
