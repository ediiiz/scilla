import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, sep } from "node:path";
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

// Locks written on Windows before paths were kept with "/" hold `skills\name`.
const slashed = (path: string) => path.split(sep).join("/");

/** A path and the folders above it, root ("") first: any of their checkouts holds the path. */
const ancestors = (path: string) => {
  const segments = path === "" ? [] : path.split("/");

  return ["", ...segments.map((_, index) => segments.slice(0, index + 1).join("/"))];
};

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
  const { stderr, code, timedOut } = await runGit(args, process.cwd(), { timeout });

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

// The store is a partial clone: reading an object it lacks would quietly fetch it, and a commit's
// whole history with it. Reads fail instead; the fetches below ask for exactly what is needed.
const NO_LAZY_FETCH = { GIT_NO_LAZY_FETCH: "1" };

const store = (dir: string, args: readonly string[], input?: string) =>
  git(args, dir, { env: NO_LAZY_FETCH, input });

const storeHas = async (dir: string, object: string) =>
  (await runGit(["cat-file", "-e", object], dir, { env: NO_LAZY_FETCH })).code === 0;

/** Where the store keeps the commit a Pin was last fetched at; its `HEAD` is `refs/pins/HEAD`. */
const pinRef = (ref: string) => `refs/pins/${ref}`;

/** The commit `rev` names in the store, or undefined when the store can't tell. */
const commitOf = async (dir: string, rev: string) => {
  const args = ["rev-parse", "--verify", "--quiet", "--end-of-options", `${rev}^{commit}`];
  const { stdout, code } = await runGit(args, dir, { env: NO_LAZY_FETCH });

  return code === 0 ? stdout.trim() : undefined;
};

/** A Pin fetched earlier; a store made before Pins were kept this way resolves the ref itself. */
const cachedPin = async (dir: string, ref: string) =>
  (await commitOf(dir, pinRef(ref))) ?? (await commitOf(dir, ref));

/** The commit alone: no history, no folders, no files. */
const PIN_FETCH = ["fetch", "--quiet", "--depth=1", "--filter=tree:0", "--no-tags", "origin"];

/** Every commit (still without folders or files), to resolve what a server can't: `HEAD~1`. */
const historyFetch = (dir: string) => [
  "fetch",
  "--quiet",
  "--filter=tree:0",
  "--no-tags",
  ...(existsSync(join(dir, "shallow")) ? ["--unshallow"] : []),
  "origin",
  `+HEAD:${pinRef("HEAD")}`,
  "+refs/heads/*:refs/heads/*",
  "+refs/tags/*:refs/tags/*",
];

/** Objects by id, in one request; `--no-filter` brings everything under a folder with it. */
const objectsFetch = (filter: string) => [
  "-c",
  "fetch.negotiationAlgorithm=noop",
  "fetch",
  "--quiet",
  "--no-tags",
  "--no-write-fetch-head",
  "--recurse-submodules=no",
  filter,
  "--stdin",
  "origin",
];

const MISSING_REF = /couldn't find remote ref|not our ref/i;

/** A Pin (or locked commit) the repo doesn't have. */
class MissingPin extends ScillaError {}

const isMissingRef = (cause: unknown) => MISSING_REF.test(detailOf(cause) ?? "");

// What `fetch` says of a refspec such as `HEAD~1:…`, which only a local `rev-parse` understands.
const isRevision = (cause: unknown) => /invalid refspec/i.test(detailOf(cause) ?? "");

/** Ids of the objects `rev-list --missing=print` marks missing (`?<id>`). */
const missingIn = (listing: string) =>
  listing.split("\n").flatMap((line) => (line.startsWith("?") ? [line.slice(1)] : []));

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
 * Fetches repos through the user's own `git`. A store per URL holds, for each commit it was asked
 * for, that commit and its folder listing but only the file contents a checkout needed; a checkout
 * per commit and path holds just that folder's files. Each Pin is fetched at most once per
 * instance; a failed fetch falls back to the commit it was last fetched at.
 */
export class Fetcher {
  readonly warnings: string[] = [];

  /** The raw output behind a warning (git's full stderr), keyed by the warning, for debug output. */
  readonly details = new Map<string, string>();

  readonly #cacheDir: string;

  readonly #stores = new Map<string, Promise<string>>();

  readonly #pins = new Map<string, Promise<string>>();

  readonly #worktrees = new Map<string, Promise<string>>();

  /** The last fetch into each store: git can't run two fetches into one shallow repo at once. */
  readonly #fetches = new Map<string, Promise<unknown>>();

  /** Objects waiting for the next fetch into a store, per URL and filter, and that fetch. */
  readonly #batches = new Map<
    string,
    { readonly ids: Set<string>; readonly sent: Promise<void> }
  >();

  #tagged: Promise<void[]> | undefined;

  constructor(cacheDir: string = defaultCacheDir()) {
    this.#cacheDir = cacheDir;
  }

  /**
   * Materialise the source's repo at its Pin (or the default branch). Only `source.path` is sure
   * to be there under the root: a checkout holds just the folder it was made for.
   */
  async checkout(source: Source): Promise<Checkout> {
    if (source.kind === "local") {
      return localCheckout(source.url);
    }

    await this.#tag();

    const commit = await this.#pin(source.url, source.ref ?? "HEAD");
    const path = slashed(source.path);
    const root = this.#known(source.url, commit, path);

    return { root: await (root ?? this.#worktree(source.url, commit, path)), commit };
  }

  /**
   * Materialise a repo at exactly `commit`, as a lock records it, without moving to anything newer.
   * A checkout or store that already has the commit is used without fetching. Fails with a clear
   * error when upstream no longer has the commit (a force-pushed branch).
   */
  async checkoutCommit(
    origin: Pick<Source, "kind" | "url" | "path">,
    commit: string,
  ): Promise<Checkout> {
    if (origin.kind === "local") {
      return localCheckout(origin.url);
    }

    // A lock is a file anyone can edit; only a full SHA may reach git as an argument.
    if (!FULL_SHA.test(commit)) {
      throw new ScillaError(`"${commit}" is not a full commit SHA.`);
    }

    await this.#tag();

    const path = slashed(origin.path);
    const known = this.#known(origin.url, commit, path);

    if (known !== undefined) {
      return { root: await known, commit };
    }

    await this.#pin(origin.url, commit).catch((cause: unknown) => {
      if (!(cause instanceof MissingPin)) {
        throw cause;
      }

      throw new ScillaError(
        `Commit ${commit.slice(0, 7)} is no longer in ${origin.url}; was it force-pushed away?`,
        detailOf(cause),
      );
    });

    return { root: await this.#worktree(origin.url, commit, path), commit };
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

  /** The URL's store: an empty bare repo at first, which fetches fill. */
  #store(url: string) {
    return once(this.#stores, url, async () => {
      const dir = join(this.#cacheDir, "repos", key(url));

      if (existsSync(dir)) {
        return dir;
      }

      const temporary = temporarySibling(dir);

      try {
        await git(["init", "--bare", "--quiet", "--template=", temporary]);
        await git(["remote", "add", "--", "origin", url], temporary);
        await writeFile(join(temporary, "HEAD"), `ref: ${pinRef("HEAD")}\n`);
      } catch (cause) {
        await rm(temporary, { recursive: true, force: true });
        throw cause;
      }

      await publish(temporary, dir);

      return dir;
    });
  }

  /** Run `task` after the store's earlier fetches, whether they worked or not. */
  #serial<T>(url: string, task: () => Promise<T>) {
    const run = (this.#fetches.get(url) ?? Promise.resolve()).then(task, task);

    this.#fetches.set(
      url,
      run.catch(() => undefined),
    );

    return run;
  }

  /**
   * The commit a Pin names, fetching only that commit. A full SHA the store has needs no fetch;
   * when the fetch fails, the commit the Pin was last fetched at is used, with a warning.
   */
  #pin(url: string, ref: string) {
    return once(this.#pins, `${url}\0${ref}`, async () => {
      const dir = await this.#store(url);

      if (FULL_SHA.test(ref) && (await storeHas(dir, `${ref}^{commit}`))) {
        return ref;
      }

      let commit: string | undefined;
      let detail: string | undefined;

      try {
        commit = await this.#resolve(url, dir, ref);
      } catch (cause) {
        const cached = isMissingRef(cause) ? undefined : await cachedPin(dir, ref);

        if (cached !== undefined) {
          this.#warn(`Using cached ${url}; fetch failed (${messageOf(cause)}).`, detailOf(cause));

          return cached;
        }

        if (!isMissingRef(cause)) {
          throw new ScillaError(`Can't fetch ${url}: ${messageOf(cause)}`, detailOf(cause));
        }

        detail = detailOf(cause);
      }

      if (commit === undefined) {
        throw new MissingPin(`Pin "${ref}" not found in ${url}.`, detail);
      }

      return commit;
    });
  }

  async #resolve(url: string, dir: string, ref: string) {
    try {
      await this.#serial(url, () => store(dir, [...PIN_FETCH, `+${ref}:${pinRef(ref)}`]));
    } catch (cause) {
      // A server resolves refs and full SHAs only; `HEAD~1` or a short SHA need the history.
      const short = COMMIT_SHA.test(ref) && !FULL_SHA.test(ref);

      if (!isRevision(cause) && !(isMissingRef(cause) && short)) {
        throw cause;
      }

      await this.#serial(url, () => store(dir, historyFetch(dir)));

      return commitOf(dir, ref);
    }

    return cachedPin(dir, ref);
  }

  /**
   * Fetch objects by id into the store, naming the repo when that fails. Requests made while an
   * earlier fetch runs share the next one, so checking out many skills side by side costs a few
   * requests, not one per skill.
   */
  async #fetchObjects(url: string, dir: string, ids: readonly string[], filter: string) {
    const id = `${url}\0${filter}`;
    let batch = this.#batches.get(id);

    if (batch === undefined) {
      const waiting = new Set<string>();

      const sent = this.#serial(url, async () => {
        // From here on, new requests wait for the fetch after this one.
        this.#batches.delete(id);
        await store(dir, objectsFetch(filter), `${[...waiting].join("\n")}\n`);
      });

      batch = { ids: waiting, sent };
      this.#batches.set(id, batch);
    }

    for (const object of ids) {
      batch.ids.add(object);
    }

    try {
      await batch.sent;
    } catch (cause) {
      throw new ScillaError(`Can't fetch ${url}: ${messageOf(cause)}`, detailOf(cause));
    }
  }

  /**
   * The folder at `path` in `commit` (a commit the store has), fetching just the folder listings
   * on the way to it; undefined when the commit has no folder there.
   */
  async #treeAt(url: string, dir: string, commit: string, path: string) {
    const root = /^tree ([0-9a-f]+)$/m.exec(await store(dir, ["cat-file", "commit", commit]))?.[1];

    return this.#descend(url, dir, root, path === "" ? [] : path.split("/"));
  }

  /** Walk down `names` from `tree`, one listing at a time: each names the next folder's id. */
  async #descend(
    url: string,
    dir: string,
    tree: string | undefined,
    names: readonly string[],
  ): Promise<string | undefined> {
    const [name, ...rest] = names;

    if (tree === undefined || name === undefined) {
      return tree;
    }

    if (!(await storeHas(dir, tree))) {
      await this.#fetchObjects(url, dir, [tree], "--filter=tree:0");
    }

    const entry = await store(dir, ["--literal-pathspecs", "ls-tree", "-z", tree, "--", name]);

    return this.#descend(url, dir, /^\d+ tree ([0-9a-f]+)\t/.exec(entry)?.[1], rest);
  }

  /** Fetch whatever under `tree` the store lacks; one request brings all of it. */
  async #complete(url: string, dir: string, tree: string) {
    const listing = async () => store(dir, ["rev-list", "--objects", "--missing=print", tree]);
    const missing = (await storeHas(dir, tree)) ? missingIn(await listing()) : [tree];

    if (missing.length === 0) {
      return;
    }

    await this.#fetchObjects(url, dir, missing, "--no-filter");

    if (missingIn(await listing()).length > 0) {
      throw new ScillaError(`Can't fetch ${url}: it didn't send every file of the folder.`);
    }
  }

  /** The folder a checkout of `path` at `commit` lives in; the whole repo's has no suffix. */
  #checkoutDir(url: string, commit: string, path: string) {
    const name = path === "" ? commit : `${commit}-${key(path).slice(0, 12)}`;

    return join(this.#cacheDir, "checkouts", key(url), name);
  }

  /** A checkout, made or underway, of `path` or a folder above it, which holds `path` too. */
  #known(url: string, commit: string, path: string) {
    for (const folder of ancestors(path)) {
      const pending = this.#worktrees.get(`${url}\0${commit}\0${folder}`);

      if (pending !== undefined) {
        return pending;
      }

      const dir = this.#checkoutDir(url, commit, folder);

      if (existsSync(dir)) {
        return Promise.resolve(dir);
      }
    }

    return undefined;
  }

  #worktree(url: string, commit: string, path: string) {
    return once(this.#worktrees, `${url}\0${commit}\0${path}`, () =>
      this.#makeWorktree(url, commit, path),
    );
  }

  /**
   * Write the files under `path` at `commit` (a commit the store has) into a checkout folder,
   * fetching only what the store lacks. A path the commit doesn't have gives an empty folder,
   * which callers report as not found.
   */
  async #makeWorktree(url: string, commit: string, path: string) {
    const dir = this.#checkoutDir(url, commit, path);

    if (existsSync(dir)) {
      return dir;
    }

    const repo = await this.#store(url);
    const tree = await this.#treeAt(url, repo, commit, path);
    const temporary = temporarySibling(dir);
    const index = `${temporary}.index`;

    await mkdir(temporary, { recursive: true });

    try {
      if (tree !== undefined) {
        await this.#complete(url, repo, tree);

        // A throwaway index, so checkouts made side by side never share one. Long paths let Git
        // for Windows write past 260 characters; the cache sits deep in the home folder.
        const env = { ...NO_LAZY_FETCH, GIT_INDEX_FILE: index };
        const prefix = path === "" ? [] : [`--prefix=${path}/`];
        const work = ["--git-dir", repo, "--work-tree", temporary, "-c", "core.longpaths=true"];

        await git(["read-tree", tree], repo, { env });
        await git([...work, "checkout-index", "--all", ...prefix], temporary, { env });
      }
    } catch (cause) {
      await rm(temporary, { recursive: true, force: true });
      throw cause;
    } finally {
      await rm(index, { force: true });
    }

    await publish(temporary, dir);

    return dir;
  }
}
