import { existsSync } from "node:fs";
import { open, readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, join, relative } from "node:path";
import { z } from "zod";
import { CACHE_TAG } from "./fetch.ts";

/** A skill folder found on disk. */
export interface FoundSkill {
  readonly name: string;
  readonly description: string;
  /** Absolute path of the skill folder. */
  readonly dir: string;
  /** Path of the skill folder relative to the scanned repo root ("" when the root is the skill). */
  readonly path: string;
  /** Repo-relative paths of files that can run code (see `isExecutable`). */
  readonly executables: readonly string[];
}

const SKILL_FILE = "SKILL.md";

const MAX_DEPTH = 6;

/** Dot-dirs that hold real skills rather than installed copies. */
const ALLOWED_DOT_DIRS = new Set([".curated", ".experimental", ".system"]);

/** Shell-type scripts: flagged wherever they are. */
const SHELL_EXTENSIONS = new Set([".sh", ".bash", ".zsh", ".fish", ".ps1", ".bat", ".cmd"]);

/** Source files that are only flagged directly under a `scripts/` or `bin/` folder. */
const SCRIPT_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".py", ".rb"]);

const SCRIPT_FOLDERS = new Set(["scripts", "bin"]);

/** Type declarations never run. */
const DECLARATION = /\.d\.[cm]?ts$/i;

const SHEBANG = "#!";

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

// A tagged cache (scilla's own `repos/` and `checkouts/`, or another tool's) holds copies, not skills.
const isCacheDir = (dir: string) => existsSync(join(dir, CACHE_TAG));

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

const startsWithShebang = async (file: string) => {
  const handle = await open(file, "r");

  try {
    const { buffer, bytesRead } = await handle.read(
      Buffer.alloc(SHEBANG.length),
      0,
      SHEBANG.length,
      0,
    );

    return buffer.toString("latin1", 0, bytesRead) === SHEBANG;
  } finally {
    await handle.close();
  }
};

/**
 * A file that can run code: one with the exec bit, a shell-type script anywhere, a script directly
 * under `scripts/` or `bin/`, or one starting with a `#!` line. Type declarations never count.
 */
const isExecutable = async (file: string) => {
  const extension = extname(file).toLowerCase();

  if (DECLARATION.test(file)) {
    return false;
  }

  if (
    SHELL_EXTENSIONS.has(extension) ||
    (SCRIPT_EXTENSIONS.has(extension) && SCRIPT_FOLDERS.has(basename(dirname(file))))
  ) {
    return true;
  }

  return ((await stat(file)).mode & EXEC_BITS) !== 0 || startsWithShebang(file);
};

const findExecutables = async (skillDir: string, root: string) => {
  const files = await listFiles(skillDir);
  const flags = await Promise.all(files.map((file) => isExecutable(file)));

  return files
    .flatMap((file, index) => (flags[index] === true ? [relative(root, file)] : []))
    .toSorted();
};

/** How many executables are named wherever they're printed, before `+N more`. */
const EXECUTABLES_SHOWN = 5;

/**
 * A skill's executables as printed: the first 5 paths, then `+N more` when there are others. The
 * full list stays on the skill; this only keeps a warning about a big skill readable.
 */
export const executablesSummary = (executables: readonly string[]) =>
  executables.length <= EXECUTABLES_SHOWN
    ? [...executables]
    : [
        ...executables.slice(0, EXECUTABLES_SHOWN),
        `+${executables.length - EXECUTABLES_SHOWN} more`,
      ];

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
  // The scan root itself is never skipped: it's what the Consumer or Curator asked for.
  if (depth > 0 && isCacheDir(dir)) {
    return [];
  }

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
 * installed-copy dot-dirs (`.agents`, `.claude`…), `node_modules` and tagged caches (a folder
 * holding a `CACHEDIR.TAG`, as scilla's own cache does). Sorted by path.
 */
export const discoverSkills = async (dir: string, root: string): Promise<FoundSkill[]> => {
  const dirs = (await walk(dir, 0)).toSorted();

  return Promise.all(dirs.map((skillDir) => readSkill(skillDir, root)));
};
