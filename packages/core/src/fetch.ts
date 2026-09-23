import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { envValue } from "./env.ts";
import { detailOf, messageOf, ScillaError } from "./errors.ts";
import { git, gitError, runGit } from "./git.ts";
import type { Source } from "./source.ts";

/** A source's repo materialised on disk at one commit. */
export interface Checkout {
  /** Directory holding the repo root. */
  readonly root: string;
  /** Full commit SHA, or "local" for a working directory. */
  readonly commit: string;
}

const LOCAL_COMMIT = "local";

/**
 * Default cache root: `$SCILLA_CACHE_DIR`, else `$XDG_CACHE_HOME/scilla`, else `~/.cache/scilla`.
 * Empty or blank variables count as unset.
 */
const defaultCacheDir = () =>
  envValue(process.env, "SCILLA_CACHE_DIR") ??
  join(envValue(process.env, "XDG_CACHE_HOME") ?? join(homedir(), ".cache"), "scilla");

/** Marks a folder as a cache (https://bford.info/cachedir/): backups and skill discovery skip it. */
export const CACHE_TAG = "CACHEDIR.TAG";

const CACHE_TAG_TEXT = `Signature: 8a477f597d28d172789f06886806bc55
# This file is a cache directory tag created by scilla.
# For information about cache directory tags, see https://bford.info/cachedir/
`;

/** Create a cache folder and tag it, so a scan that passes through it never reads the checkouts. */
const makeTaggedDir = async (dir: string) => {
  await mkdir(dir, { recursive: true });

  const tag = join(dir, CACHE_TAG);

  if (!existsSync(tag)) {
    await writeFile(tag, CACHE_TAG_TEXT);
  }
};

// A cache directory name, not a security boundary; 32 hex digits keep paths short.
const key = (url: string) => createHash("sha256").update(url).digest("hex").slice(0, 32);

// A full commit SHA (or an abbreviation) can't be matched by `ls-remote`, which lists refs only.
const COMMIT_SHA = /^[0-9a-f]{7,40}$/i;

const FULL_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

const PROBE_TIMEOUT_MS = 10_000;

export interface ProbeOptions {
  /** How long `git ls-remote` may run before it is killed, in ms; 10 s by default. */
  readonly timeout?: number;
}

/**
 * Check that a git source's repo (and its Pin, when that names a ref) is reachable, without
 * fetching it. Returns why it isn't, or undefined when it is or the source is local.
 */
export const probeSource = async (
  source: Source,
  { timeout = PROBE_TIMEOUT_MS }: ProbeOptions = {},
) => {
  if (source.kind === "local") {
    return undefined;
  }

  const ref = source.ref === undefined || COMMIT_SHA.test(source.ref) ? [] : [source.ref];
  const args = ["ls-remote", "--exit-code", "--", source.url, ...ref];
  const { stderr, code, timedOut } = await runGit(args, process.cwd(), timeout);

  if (timedOut) {
    return `Can't reach ${source.url}: git ls-remote gave no answer within ${timeout / 1000} s.`;
  }

  if (code === 0) {
    return undefined;
  }

  // `--exit-code` exits 2, silently, when the repo answered but has no matching ref.
  return code === 2 && ref.length > 0
    ? `Pin "${source.ref}" not found in ${source.url}.`
    : `Can't reach ${source.url}: ${gitError(["ls-remote"], stderr, code).message}`;
};

const localCheckout = (dir: string): Checkout => {
  if (!existsSync(dir)) {
    throw new ScillaError(`Local path ${dir} does not exist.`);
  }

  return { root: dir, commit: LOCAL_COMMIT };
};

/** Whether a repo holds `commit` (a full SHA). */
const hasCommit = async (repo: string, commit: string) =>
  (await runGit(["cat-file", "-e", `${commit}^{commit}`], repo)).code === 0;

const temporarySibling = (dir: string) => `${dir}.tmp-${randomUUID()}`;

/** Move a finished temporary dir into place; if another process got there first, keep theirs. */
const publish = async (temporary: string, dir: string) => {
  try {
    await rename(temporary, dir);
  } catch (cause) {
    await rm(temporary, { recursive: true, force: true });

    if (!existsSync(dir)) {
      throw cause;
    }
  }
};

/** Run `make` once per key, sharing the pending promise between concurrent callers. */
const once = (cache: Map<string, Promise<string>>, id: string, make: () => Promise<string>) => {
  const known = cache.get(id);

  if (known !== undefined) {
    return known;
  }

  const pending = make();

  cache.set(id, pending);

  return pending;
};

/**
 * Fetches repos through the user's own `git`, keeping a mirror per URL and a checkout per commit.
 * Each URL is fetched at most once per instance; a failed fetch falls back to an existing mirror.
 */
export class Fetcher {
  readonly warnings: string[] = [];

  /** The raw output behind a warning (git's full stderr), keyed by the warning, for debug output. */
  readonly details = new Map<string, string>();

  readonly #cacheDir: string;

  readonly #mirrors = new Map<string, Promise<string>>();

  readonly #worktrees = new Map<string, Promise<string>>();

  #tagged: Promise<void[]> | undefined;

  constructor(cacheDir: string = defaultCacheDir()) {
    this.#cacheDir = cacheDir;
  }

  /** Materialise the source's repo at its Pin (or the default branch). */
  async checkout(source: Source): Promise<Checkout> {
    if (source.kind === "local") {
      return localCheckout(source.url);
    }

    await this.#tag();

    const mirror = await this.#mirror(source.url);
    const commit = await this.#resolve(mirror, source);

    return { root: await this.#worktree(source.url, mirror, commit), commit };
  }

  /**
   * Materialise a repo at exactly `commit`, as a lock records it, without moving to anything newer.
   * A checkout or mirror that already has the commit is used without fetching. Fails with a clear
   * error when upstream no longer has the commit (a force-pushed branch).
   */
  async checkoutCommit(origin: Pick<Source, "kind" | "url">, commit: string): Promise<Checkout> {
    if (origin.kind === "local") {
      return localCheckout(origin.url);
    }

    // A lock is a file anyone can edit; only a full SHA may reach git as an argument.
    if (!FULL_SHA.test(commit)) {
      throw new ScillaError(`"${commit}" is not a full commit SHA.`);
    }

    await this.#tag();

    const known = join(this.#cacheDir, "checkouts", key(origin.url), commit);

    if (existsSync(known)) {
      return { root: known, commit };
    }

    const cached = join(this.#cacheDir, "repos", key(origin.url));
    const offline = existsSync(cached) && (await hasCommit(cached, commit));
    const mirror = offline ? cached : await this.#mirror(origin.url);

    if (!offline && !(await hasCommit(mirror, commit))) {
      throw new ScillaError(
        `Commit ${commit.slice(0, 7)} is no longer in ${origin.url}; was it force-pushed away?`,
      );
    }

    return { root: await this.#worktree(origin.url, mirror, commit), commit };
  }

  /** Keep the raw output behind a warning, raised here or by a Traversal, for debug output. */
  explain(warning: string, detail: string | undefined) {
    if (detail !== undefined) {
      this.details.set(warning, detail);
    }
  }

  // Tagged on every run, so caches made before the tag existed get one too.
  #tag() {
    this.#tagged ??= Promise.all(
      ["repos", "checkouts"].map((dir) => makeTaggedDir(join(this.#cacheDir, dir))),
    );

    return this.#tagged;
  }

  #warn(warning: string, detail: string | undefined) {
    this.warnings.push(warning);
    this.explain(warning, detail);
  }

  #mirror(url: string) {
    return once(this.#mirrors, url, () => this.#fetchMirror(url));
  }

  #worktree(url: string, mirror: string, commit: string) {
    return once(this.#worktrees, `${url}\0${commit}`, () =>
      this.#makeWorktree(url, mirror, commit),
    );
  }

  async #fetchMirror(url: string) {
    const dir = join(this.#cacheDir, "repos", key(url));

    if (existsSync(dir)) {
      try {
        await git(["remote", "update", "--prune"], dir);
      } catch (cause) {
        this.#warn(`Using cached ${url}; fetch failed (${messageOf(cause)}).`, detailOf(cause));
      }

      return dir;
    }

    const temporary = temporarySibling(dir);

    try {
      await git(["clone", "--mirror", "--quiet", "--", url, temporary]);
    } catch (cause) {
      await rm(temporary, { recursive: true, force: true });
      throw new ScillaError(`Can't fetch ${url}: ${messageOf(cause)}`, detailOf(cause));
    }

    await publish(temporary, dir);

    return dir;
  }

  async #resolve(mirror: string, source: Source) {
    const ref = source.ref ?? "HEAD";

    try {
      return await git(["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`], mirror);
    } catch {
      throw new ScillaError(`Pin "${ref}" not found in ${source.url}.`);
    }
  }

  async #makeWorktree(url: string, mirror: string, commit: string) {
    const dir = join(this.#cacheDir, "checkouts", key(url), commit);

    if (existsSync(dir)) {
      return dir;
    }

    const temporary = temporarySibling(dir);

    await mkdir(join(this.#cacheDir, "checkouts", key(url)), { recursive: true });

    try {
      await git(["clone", "--shared", "--no-checkout", "--quiet", mirror, temporary]);
      await git(["checkout", "--quiet", "--detach", commit], temporary);
    } catch (cause) {
      await rm(temporary, { recursive: true, force: true });
      throw cause;
    }

    await publish(temporary, dir);

    return dir;
  }
}
