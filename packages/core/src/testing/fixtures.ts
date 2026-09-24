import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Fetcher } from "../fetch.ts";
import type { Scope } from "../lock.ts";
import type { Manifest } from "../manifest.ts";

// Keep git and scilla away from the real home: no user or system git config, and a temp cache.
process.env["GIT_CONFIG_GLOBAL"] = "/dev/null";

process.env["GIT_CONFIG_NOSYSTEM"] = "1";

const created: string[] = [];

/** Remove every temp dir made so far; each test file calls it from `afterAll`. */
export const cleanup = () => {
  for (const dir of created.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
};

/** A fresh temp directory, removed by `cleanup`. */
export const tempDir = (label = "fixture") => {
  const dir = mkdtempSync(join(tmpdir(), `scilla-${label}-`));

  created.push(dir);

  return dir;
};

process.env["SCILLA_CACHE_DIR"] = tempDir("cache-env");

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "Fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.invalid",
};

const git = (dir: string, ...args: string[]) => {
  const result = Bun.spawnSync(["git", ...args], { cwd: dir, env: GIT_ENV });

  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
  }

  return result.stdout.toString().trim();
};

/** Repo-relative path → file contents. A path ending in `*` is written executable (without the `*`). */
export type Files = Readonly<Record<string, string>>;

/** Write `files` under `dir`, creating parent folders. */
export const writeFiles = (dir: string, files: Files) => {
  for (const [name, content] of Object.entries(files)) {
    const executable = name.endsWith("*");
    const file = join(dir, executable ? name.slice(0, -1) : name);

    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);

    if (executable) {
      chmodSync(file, 0o755);
    }
  }
};

/** SKILL.md text with `name`/`description` frontmatter. */
export const skillMd = (name: string, description = `The ${name} skill.`) =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`;

/** Files for a skill folder at `path` holding just a SKILL.md. */
export const skill = (path: string, name: string, description?: string) => ({
  [`${path}/SKILL.md`]: skillMd(name, description),
});

/** A `scilla.json` file entry. */
export const manifest = (name: string, extra: Omit<Manifest, "name" | "description"> = {}) => ({
  "scilla.json": JSON.stringify({ name, description: `${name} description`, ...extra }),
});

/** A git repo in a temp dir with helpers to commit more, tag and branch. */
export class Repo {
  readonly dir: string;

  constructor(files: Files) {
    this.dir = tempDir("repo");
    git(this.dir, "init", "--quiet", "--initial-branch=main");
    // Serve partial and by-id fetches, as GitHub does, so the Fetcher's lean path runs.
    git(this.dir, "config", "uploadpack.allowFilter", "true");
    git(this.dir, "config", "uploadpack.allowAnySHA1InWant", "true");
    this.commit(files);
  }

  /** The `file://` URL a Reference uses to reach this repo through git. */
  get url() {
    return `file://${this.dir}`;
  }

  /** Write `files` (and delete `remove` paths), commit, and return the new commit SHA. */
  commit(files: Files, remove: readonly string[] = []) {
    writeFiles(this.dir, files);

    for (const path of remove) {
      rmSync(join(this.dir, path), { recursive: true, force: true });
    }

    git(this.dir, "add", "--all");
    git(this.dir, "commit", "--quiet", "--allow-empty", "--message", "fixture");

    return this.head();
  }

  /** Rewrite the last commit with `files` (a force-push upstream); returns the new commit SHA. */
  amend(files: Files) {
    writeFiles(this.dir, files);
    git(this.dir, "add", "--all");
    git(this.dir, "commit", "--quiet", "--amend", "--message", "fixture (rewritten)");
    // Gone for good, so a fetch of the old commit by id fails as it would upstream.
    git(this.dir, "reflog", "expire", "--expire=now", "--all");
    git(this.dir, "gc", "--quiet", "--prune=now");

    return this.head();
  }

  head() {
    return git(this.dir, "rev-parse", "HEAD");
  }

  tag(name: string) {
    git(this.dir, "tag", name);
  }

  /** Create `name` at HEAD and commit `files` on it, then return to main. Returns the branch's commit. */
  branch(name: string, files: Files) {
    git(this.dir, "checkout", "--quiet", "-b", name);

    const commit = this.commit(files);

    git(this.dir, "checkout", "--quiet", "main");

    return commit;
  }
}

/** A Fetcher with its own temp cache. */
export const fetcher = () => new Fetcher(tempDir("cache"));

/** A temp install scope; `claude` creates `<base>/.claude` so links get made. */
export const scope = (
  options: { readonly claude?: boolean; readonly global?: boolean } = {},
): Scope => {
  const base = tempDir("scope");

  if (options.claude === true) {
    mkdirSync(join(base, ".claude"));
  }

  return { base, global: options.global === true };
};
