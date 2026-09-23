import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { computeSkillHash, hashIfPresent } from "./hash.ts";
import { cleanup, tempDir, writeFiles } from "./testing/fixtures.ts";

afterAll(cleanup);

const REPO_ROOT = join(import.meta.dir, "../../..");

const SkillsLockSchema = z.object({
  skills: z.record(z.string(), z.object({ computedHash: z.string() })),
});

const skillsLock = SkillsLockSchema.parse(
  await Bun.file(join(REPO_ROOT, "skills-lock.json")).json(),
);

describe("computeSkillHash", () => {
  // Real evidence: this repo's .agents/skills were installed by the skills CLI, which wrote these hashes.
  test.each(["tdd", "code-review", "research", "grilling", "diagnosing-bugs"])(
    "matches the skills CLI's computedHash for %s",
    async (name) => {
      const expected = skillsLock.skills[name]?.computedHash ?? "missing from skills-lock.json";

      expect(await computeSkillHash(join(REPO_ROOT, ".agents", "skills", name))).toBe(expected);
    },
  );

  test("hashes paths and bytes, skipping .git and node_modules", async () => {
    const a = tempDir();
    const b = tempDir();

    writeFiles(a, { "SKILL.md": "x", "sub/b.txt": "y" });
    writeFiles(b, {
      "SKILL.md": "x",
      "sub/b.txt": "y",
      ".git/HEAD": "z",
      "node_modules/m/i.js": "z",
    });

    expect(await computeSkillHash(a)).toBe(await computeSkillHash(b));

    writeFiles(b, { "sub/b.txt": "changed" });

    expect(await computeSkillHash(a)).not.toBe(await computeSkillHash(b));
  });

  test("hashIfPresent is undefined for a missing folder", async () => {
    const dir = tempDir();

    mkdirSync(join(dir, "empty"));

    expect(await hashIfPresent(join(dir, "missing"))).toBeUndefined();
    expect(await hashIfPresent(join(dir, "empty"))).toMatch(/^[0-9a-f]{64}$/);
  });
});
