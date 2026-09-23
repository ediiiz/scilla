import {
  compareInstalled,
  compareTraversals,
  Fetcher,
  findCollection,
  fromLockSource,
  lockedSkillDir,
  readLock,
  readManifest,
  referenceStatuses,
  ScillaError,
  traverse,
  type Lock,
  type ReferenceStatus,
  type SkillUpdate,
  type Source,
} from "@scilla/core";
import { scopeFor, type Io } from "./io.ts";
import { Reporter } from "./report.ts";

/** One Collection's skill updates. */
export interface Section {
  /** `Name (key)` for an installed Collection, `Collection "Name"` for the one in the cwd. */
  readonly title: string;
  /** The commit it was installed at and the one upstream is at; undefined for the cwd's Collection. */
  readonly commits: { readonly before: string; readonly after: string } | undefined;
  readonly updates: readonly SkillUpdate[];
}

/** What `outdated`, `diff` and `review propose` look at, installed (Consumer) or reviewed (Curator). */
export interface Gathered {
  /** The cwd is a Collection and its References were compared with their reviews. */
  readonly curator: boolean;
  readonly sections: readonly Section[];
  /** Curator: each fetched Reference against its reviewed commit. Consumer: empty. */
  readonly statuses: readonly ReferenceStatus[];
  /** A folder with a skill's files before the update; undefined for a new skill. */
  readonly beforeDir: (update: SkillUpdate) => Promise<string | undefined>;
  /** Curator: the root Reference an update comes through; undefined for Own Skills. */
  readonly referenceOf: (update: SkillUpdate) => string | undefined;
  /** The query named a Collection, so every update belongs to what was asked for. */
  readonly narrowed: boolean;
  /** Every name a `diff` target can match, to tell an unknown target from an unchanged one. */
  readonly known: ReadonlySet<string>;
}

/** Inside a Collection (and without `-g`), `outdated` and `diff` are the Curator's views. */
const curating = async (io: Io, global: boolean) =>
  !global && (await readManifest(io.cwd)) !== undefined;

const collectionKeys = (lock: Lock, query: string | undefined) => {
  if (query === undefined) {
    return Object.keys(lock.collections).toSorted();
  }

  const key = findCollection(lock, query);

  return key === undefined ? [] : [key];
};

/**
 * Re-traverse installed Collections (all, or the one `query` names) and compare them with the
 * lock. A `query` that names no Collection compares them all; `diff` then narrows to a skill.
 */
const gatherInstalled = async (io: Io, global: boolean, query: string | undefined) => {
  const scope = scopeFor(io, global);
  const lock = await readLock(scope);
  const fetcher = new Fetcher(io.cacheDir);
  const found = collectionKeys(lock, query);
  const keys = found.length === 0 ? collectionKeys(lock, undefined) : found;

  const compared = await io.tui.withProgress(
    "Checking upstream",
    () =>
      Promise.all(
        keys.flatMap((key) => {
          const entry = lock.collections[key];

          return entry === undefined
            ? []
            : [
                traverse(fromLockSource(entry.source), fetcher, { home: io.home }).then(
                  async (traversal) => ({
                    traversal,
                    update: await compareInstalled(key, entry, lock, traversal),
                  }),
                ),
              ];
        }),
      ),
    io.stderr,
  );

  const reporter = new Reporter(io);

  for (const { traversal } of compared) {
    reporter.warnAll(traversal.warnings, fetcher.details);
  }

  const beforeDir = (update: SkillUpdate) => {
    const entry = lock.skills[update.name];

    return update.before === undefined || entry === undefined
      ? Promise.resolve(undefined)
      : lockedSkillDir(scope, update.name, entry, fetcher);
  };

  return {
    curator: false,
    sections: compared.map(({ update }) => ({
      title: `${update.name} (${update.key})`,
      commits: { before: update.before, after: update.after },
      updates: update.skills,
    })),
    statuses: [],
    beforeDir,
    referenceOf: () => undefined,
    narrowed: query !== undefined && found.length > 0,
    known: new Set([
      ...Object.keys(lock.skills),
      ...compared.flatMap(({ traversal }) => traversal.skills.map((skill) => skill.name)),
    ]),
  } satisfies Gathered;
};

/** Compare the cwd's Collection as Consumers get it (its reviews) with its References' upstream. */
const gatherReviewed = async (io: Io) => {
  const fetcher = new Fetcher(io.cacheDir);
  const source: Source = { kind: "local", url: io.cwd, path: "", ref: undefined, skill: undefined };
  const home = io.home;

  const [statuses, reviewed, upstream] = await io.tui.withProgress(
    "Checking upstream",
    () =>
      Promise.all([
        referenceStatuses(io.cwd, fetcher, home),
        traverse(source, fetcher, { home }),
        traverse(source, fetcher, { home, reviewed: false }),
      ]),
    io.stderr,
  );

  new Reporter(io).warnAll([...reviewed.warnings, ...upstream.warnings], fetcher.details);

  const before = new Map(reviewed.skills.map((skill) => [skill.name, skill]));

  return {
    curator: true,
    sections: [
      {
        title: `Collection "${reviewed.name}"`,
        commits: undefined,
        updates: await compareTraversals(reviewed, upstream),
      },
    ],
    statuses,
    beforeDir: (update: SkillUpdate) => Promise.resolve(before.get(update.name)?.dir),
    referenceOf: (update: SkillUpdate) =>
      update.after?.reference ?? before.get(update.name)?.reference,
    narrowed: false,
    known: new Set([
      ...statuses.map((status) => status.key),
      ...[...reviewed.skills, ...upstream.skills].map((skill) => skill.name),
    ]),
  } satisfies Gathered;
};

/** Gather the Curator's view inside a Collection, else the Consumer's (`query` narrows it). */
export const gather = async (
  io: Io,
  global: boolean,
  query: string | undefined,
): Promise<Gathered> =>
  (await curating(io, global)) ? gatherReviewed(io) : gatherInstalled(io, global, query);

/** Gather the Curator's view; fails outside a Collection. */
export const gatherCollection = async (io: Io): Promise<Gathered> => {
  if (!(await curating(io, false))) {
    throw new ScillaError(`${io.cwd} is not a Collection (no scilla.json).`);
  }

  return gatherReviewed(io);
};
