import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync } from "node:fs";
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

// Contents chosen to exercise the ordering rules: case, underscores, dot folders, non-ASCII names.
const SKILLS_CLI_FIXTURE = {
  "SKILL.md": "---\nname: fixture\ndescription: Hash fixture\n---\n\n# Fixture\n",
  "README.md": "Upper-case sorts with localeCompare, not byte order.\n",
  "a.txt": "a\n",
  "B.txt": "B\n",
  "scripts/run.sh": "#!/bin/sh\necho hi\n",
  "scripts/_helper.sh": "true\n",
  "references/z-last.md": "z\n",
  "references/Émile.md": "unicode name\n",
  ".hidden/config": "dot folder\n",
  ".git/HEAD": "ignored",
  "node_modules/x/i.js": "ignored",
};

// Produced by computeSkillFolderHash, copied verbatim from skills@1.7.0 dist/cli.mjs, over the files above.
const SKILLS_CLI_HASH = "497373bc8f2711d0164d9c9c2d1ca599a946b45441524c93deaef3f9b1daa17b";

// Skills installed into this checkout by the skills CLI; absent in CI, since .agents/skills is gitignored.
const INSTALLED = join(REPO_ROOT, ".agents", "skills");

describe("computeSkillHash", () => {
  test("matches the skills CLI's computedHash for a fixture folder", async () => {
    const dir = tempDir();

    writeFiles(dir, SKILLS_CLI_FIXTURE);

    expect(await computeSkillHash(dir)).toBe(SKILLS_CLI_HASH);
  });

  test
    .skipIf(!existsSync(INSTALLED))
    .each(["tdd", "code-review", "research", "grilling", "diagnosing-bugs"])(
    "matches the skills CLI's computedHash for the installed %s skill",
    async (name) => {
      const expected = skillsLock.skills[name]?.computedHash ?? "missing from skills-lock.json";

      expect(await computeSkillHash(join(INSTALLED, name))).toBe(expected);
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
