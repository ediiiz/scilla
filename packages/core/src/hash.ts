import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const SKIPPED = new Set([".git", "node_modules"]);

const collect = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true });

  const nested = await Promise.all(
    entries.map((entry) => {
      const full = join(dir, entry.name);

      if (entry.isDirectory()) {
        return SKIPPED.has(entry.name) ? [] : collect(full);
      }

      return entry.isFile() ? [full] : [];
    }),
  );

  return nested.flat();
};

/**
 * The skills CLI's `computedHash`: SHA-256 over each file's POSIX relative path followed by its
 * bytes, files sorted with `localeCompare`, skipping `.git` and `node_modules`.
 */
export const computeSkillHash = async (dir: string) => {
  const files = (await collect(dir)).map((file) => ({
    file,
    path: relative(dir, file).split(sep).join("/"),
  }));

  files.sort((a, b) => a.path.localeCompare(b.path));

  const contents = await Promise.all(files.map(({ file }) => readFile(file)));
  const hash = createHash("sha256");

  for (const [index, { path }] of files.entries()) {
    hash.update(path);
    hash.update(contents[index] ?? "");
  }

  return hash.digest("hex");
};

/** Hash of the folder, or undefined when it doesn't exist. */
export const hashIfPresent = async (dir: string) =>
  existsSync(dir) ? computeSkillHash(dir) : undefined;
