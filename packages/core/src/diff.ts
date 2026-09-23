import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative, sep } from "node:path";
import { findExecutables } from "./discovery.ts";
import { gitError, runGit } from "./git.ts";
import { collect } from "./hash.ts";

export type FileChange = "added" | "removed" | "modified";

/** One file that differs between two versions of a skill. */
export interface FileDiff {
  /** Relative to the skill folder, with `/` separators. */
  readonly path: string;
  readonly change: FileChange;
  /** Either version holds a NUL byte early on, as git decides it. */
  readonly binary: boolean;
  /** The newer version can run code (see `isExecutable`); for a removed file, the older one. */
  readonly executable: boolean;
}

/** What changed between two versions of a skill folder. */
export interface SkillDiff {
  /** Sorted by path. A file whose bytes or whose ability to run code changed is `modified`. */
  readonly files: readonly FileDiff[];
  /** A unified diff (git's format) with paths relative to the skill folder; empty when identical. */
  readonly patch: string;
}

/** The newer version's files that can run code and are new or changed: worth a close look. */
export const riskyFiles = (diff: SkillDiff) =>
  diff.files.flatMap((file) => (file.executable && file.change !== "removed" ? [file] : []));

// git's own test for binary content: a NUL byte in the first 8000 bytes.
const BINARY_PROBE = 8000;

const isBinary = (bytes: Buffer | undefined) =>
  bytes !== undefined && bytes.subarray(0, BINARY_PROBE).includes(0);

interface Version {
  readonly files: ReadonlyMap<string, Buffer>;
  readonly executables: ReadonlySet<string>;
}

const NO_VERSION: Version = { files: new Map(), executables: new Set() };

const readVersion = async (dir: string | undefined): Promise<Version> => {
  if (dir === undefined) {
    return NO_VERSION;
  }

  const paths = await collect(dir);
  const contents = await Promise.all(paths.map((path) => readFile(path)));
  const executables = await findExecutables(dir, dir);
  const posix = (path: string) => relative(dir, path).split(sep).join("/");

  return {
    files: new Map(paths.map((path, index) => [posix(path), contents[index] ?? Buffer.alloc(0)])),
    executables: new Set(executables.map((path) => path.split(sep).join("/"))),
  };
};

const changeOf = (before: Version, after: Version, path: string): FileChange | undefined => {
  const old = before.files.get(path);
  const next = after.files.get(path);

  if (old === undefined) {
    return "added";
  }

  if (next === undefined) {
    return "removed";
  }

  const same = old.equals(next) && before.executables.has(path) === after.executables.has(path);

  return same ? undefined : "modified";
};

const fileDiffs = (before: Version, after: Version) => {
  const paths = [...new Set([...before.files.keys(), ...after.files.keys()])].toSorted();

  return paths.flatMap((path): FileDiff[] => {
    const change = changeOf(before, after, path);

    if (change === undefined) {
      return [];
    }

    const side = change === "removed" ? before : after;

    return [
      {
        path,
        change,
        binary: isBinary(before.files.get(path)) || isBinary(after.files.get(path)),
        executable: side.executables.has(path),
      },
    ];
  });
};

const SKIPPED = new Set([".git", "node_modules"]);

const copyVersion = (dir: string | undefined, to: string) =>
  dir === undefined
    ? mkdir(to)
    : cp(dir, to, { recursive: true, filter: (path) => !SKIPPED.has(basename(path)) });

/**
 * git's unified diff of two folders. Copies named `a` and `b` in a scratch folder give the paths
 * git's usual `a/<path>`, `b/<path>` look, relative to the skill folder.
 */
const patchOf = async (before: string | undefined, after: string | undefined) => {
  const scratch = await mkdtemp(join(tmpdir(), "scilla-diff-"));

  try {
    await Promise.all([
      copyVersion(before, join(scratch, "a")),
      copyVersion(after, join(scratch, "b")),
    ]);

    const args = [
      "-c",
      "core.quotePath=false",
      "diff",
      "--no-index",
      "--no-color",
      "--no-ext-diff",
      "--src-prefix=",
      "--dst-prefix=",
      "--",
      "a",
      "b",
    ];

    const { stdout, stderr, code } = await runGit(args, scratch);

    // `--no-index` exits 1 when the folders differ; anything above that is a failure.
    if (code > 1) {
      throw gitError(["diff"], stderr, code);
    }

    return stdout;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
};

/**
 * Compare two versions of a skill folder: `before` undefined means the skill is new, `after`
 * undefined means it's gone. `.git` and `node_modules` are left out, as the install leaves them out.
 */
export const diffSkill = async (
  before: string | undefined,
  after: string | undefined,
): Promise<SkillDiff> => {
  const [old, next, patch] = await Promise.all([
    readVersion(before),
    readVersion(after),
    patchOf(before, after),
  ]);

  return { files: fileDiffs(old, next), patch };
};
