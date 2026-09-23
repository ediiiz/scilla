import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import { z } from "zod";

/** A skill folder found on disk. */
export interface FoundSkill {
  readonly name: string;
  readonly description: string;
  /** Absolute path of the skill folder. */
  readonly dir: string;
  /** Path of the skill folder relative to the scanned repo root ("" when the root is the skill). */
  readonly path: string;
  /** Repo-relative paths of files that can run code (exec bit or a script extension). */
  readonly executables: readonly string[];
}

const SKILL_FILE = "SKILL.md";

const MAX_DEPTH = 6;

/** Dot-dirs that hold real skills rather than installed copies. */
const ALLOWED_DOT_DIRS = new Set([".curated", ".experimental", ".system"]);

const SCRIPT_EXTENSIONS = new Set([
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".py",
  ".rb",
  ".pl",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".mts",
  ".ps1",
  ".bat",
  ".cmd",
  ".exe",
]);

const EXEC_BITS = 0o111;

// Frontmatter is parsed leniently: real skills carry many non-spec keys and odd value types.
const FrontmatterSchema = z
  .object({
    name: z.string().trim().min(1).optional().catch(undefined),
    description: z.string().optional().catch(undefined),
  })
  .catch({ name: undefined, description: undefined });

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;

const parseFrontmatter = (text: string) => {
  const block = FRONTMATTER.exec(text.replace(/^\uFEFF/, ""))?.[1];

  if (block === undefined) {
    return FrontmatterSchema.parse({});
  }

  try {
    return FrontmatterSchema.parse(Bun.YAML.parse(block));
  } catch {
    return FrontmatterSchema.parse({});
  }
};

const skipDir = (name: string) =>
  name === "node_modules" || (name.startsWith(".") && !ALLOWED_DOT_DIRS.has(name));

const listFiles = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true });

  const nested = await Promise.all(
    entries.map(async (entry) => {
      const full = join(dir, entry.name);

      if (entry.isDirectory()) {
        return entry.name === ".git" || entry.name === "node_modules" ? [] : listFiles(full);
      }

      return entry.isFile() ? [full] : [];
    }),
  );

  return nested.flat();
};

const isExecutable = async (file: string) =>
  SCRIPT_EXTENSIONS.has(extname(file).toLowerCase()) || ((await stat(file)).mode & EXEC_BITS) !== 0;

const findExecutables = async (skillDir: string, root: string) => {
  const files = await listFiles(skillDir);
  const flags = await Promise.all(files.map((file) => isExecutable(file)));

  return files
    .flatMap((file, index) => (flags[index] === true ? [relative(root, file)] : []))
    .toSorted();
};

/** Read the skill folder at `dir` (which must contain SKILL.md); `root` is the repo it came from. */
export const readSkill = async (dir: string, root: string): Promise<FoundSkill> => {
  const frontmatter = parseFrontmatter(await readFile(join(dir, SKILL_FILE), "utf8"));

  return {
    name: frontmatter.name ?? basename(dir),
    description: frontmatter.description?.trim() ?? "",
    dir,
    path: relative(root, dir),
    executables: await findExecutables(dir, root),
  };
};

export const isSkillDir = (dir: string) => existsSync(join(dir, SKILL_FILE));

const walk = async (dir: string, depth: number): Promise<string[]> => {
  if (isSkillDir(dir)) {
    return [dir];
  }

  if (depth >= MAX_DEPTH) {
    return [];
  }

  const entries = await readdir(dir, { withFileTypes: true });

  const nested = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory() && !skipDir(entry.name) ? walk(join(dir, entry.name), depth + 1) : [],
    ),
  );

  return nested.flat();
};

/**
 * Find every skill under `dir`, stopping at the first SKILL.md on each branch and skipping
 * installed-copy dot-dirs (`.agents`, `.claude`…) and `node_modules`. Sorted by path.
 */
export const discoverSkills = async (dir: string, root: string): Promise<FoundSkill[]> => {
  const dirs = (await walk(dir, 0)).toSorted();

  return Promise.all(dirs.map((skillDir) => readSkill(skillDir, root)));
};
