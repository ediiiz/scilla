import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { installedDir, installedHash, installSkillFiles, removeSkillFiles } from "./install.ts";
import { cleanup, scope, skill, tempDir, writeFiles } from "./testing/fixtures.ts";

afterAll(cleanup);

const source = () => {
  const dir = tempDir();

  writeFiles(dir, { ...skill("a", "a"), "a/node_modules/x/i.js": "", "a/ref.md": "text" });

  return join(dir, "a");
};

describe("installSkillFiles", () => {
  test("replaces an old copy and a stale link", async () => {
    const target = scope({ claude: true });
    const links = join(target.base, ".claude", "skills");

    writeFiles(installedDir(target, "a"), { "old.md": "stale" });
    mkdirSync(links);
    symlinkSync("/nowhere", join(links, "a"));

    expect(await installSkillFiles(target, "a", source())).toEqual([]);
    expect(existsSync(join(installedDir(target, "a"), "old.md"))).toBe(false);
    expect(existsSync(join(installedDir(target, "a"), "node_modules"))).toBe(false);
    expect(existsSync(join(links, "a", "ref.md"))).toBe(true);
    expect(await installedHash(target, "a")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("removeSkillFiles", () => {
  test("removes the copy and its link but not a real folder of the same name", async () => {
    const linked = scope({ claude: true });

    await installSkillFiles(linked, "a", source());
    await removeSkillFiles(linked, "a");

    expect(existsSync(installedDir(linked, "a"))).toBe(false);
    expect(() => lstatSync(join(linked.base, ".claude", "skills", "a"))).toThrow();

    const real = scope({ claude: true });

    writeFiles(real.base, skill(".claude/skills/a", "a"));
    await removeSkillFiles(real, "a");

    expect(existsSync(join(real.base, ".claude", "skills", "a", "SKILL.md"))).toBe(true);
    expect(await installedHash(real, "a")).toBeUndefined();
  });
});
