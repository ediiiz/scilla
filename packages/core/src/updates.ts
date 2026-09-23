import { join } from "node:path";
import type { Fetcher } from "./fetch.ts";
import { computeSkillHash, hashIfPresent } from "./hash.ts";
import { installedDir } from "./install.ts";
import type { CollectionEntry, Lock, Scope, SkillEntry } from "./lock.ts";
import type { SourceKind } from "./source.ts";
import type { ResolvedSkill, Traversal } from "./traversal.ts";

/**
 * How a skill differs between what's installed (or reviewed) and upstream:
 * - `changed`: its files differ
 * - `new`: upstream offers it, and it was never selected or declined
 * - `removed`: it's gone upstream
 * - `moved`: its commit or origin moved, but its files are the same
 */
export type SkillChange = "changed" | "new" | "removed" | "moved";

/** Where a version of a skill came from. */
export interface SkillOrigin {
  readonly name: string;
  readonly kind: SourceKind;
  readonly url: string;
  readonly path: string;
  readonly commit: string;
}

export interface SkillUpdate {
  readonly name: string;
  readonly change: SkillChange;
  /** What's installed (Consumer) or reviewed (Curator); undefined for a new skill. */
  readonly before: SkillOrigin | undefined;
  /** What upstream has now; undefined for a removed skill. */
  readonly after: ResolvedSkill | undefined;
}

/** What `scilla update` would do to one installed Collection. */
export interface CollectionUpdate {
  /** The Collection's key in the lock. */
  readonly key: string;
  readonly name: string;
  /** The commit the Collection was installed at, and the one upstream is at now. */
  readonly before: string;
  readonly after: string;
  /** Every skill that differs, by name; unchanged skills are left out. */
  readonly skills: readonly SkillUpdate[];
}

/** Whether applying the updates would change any installed skill; moves alone change nothing. */
export const changesSkills = (updates: readonly SkillUpdate[]) =>
  updates.some((update) => update.change !== "moved");

const byName = (a: SkillUpdate, b: SkillUpdate) => a.name.localeCompare(b.name);

const originOf = (name: string, entry: SkillEntry): SkillOrigin => ({
  name,
  kind: entry.kind,
  url: entry.url,
  path: entry.path,
  commit: entry.commit,
});

const sameOrigin = (a: SkillOrigin, b: SkillOrigin) =>
  a.url === b.url && a.path === b.path && a.commit === b.commit;

/** Compare one kept skill; its files are hashed only when both sides exist. */
const compareKept = async (
  before: SkillOrigin,
  beforeHash: string | undefined,
  after: ResolvedSkill,
): Promise<SkillUpdate | undefined> => {
  if (beforeHash !== (await computeSkillHash(after.dir))) {
    return { name: after.name, change: "changed", before, after };
  }

  return sameOrigin(before, after)
    ? undefined
    : { name: after.name, change: "moved", before, after };
};

const present = <T>(values: readonly (T | undefined)[]) =>
  values.flatMap((value) => (value === undefined ? [] : [value]));

/**
 * Compare an installed Collection's lock entry with a fresh Traversal of it: the selected skills
 * that changed, moved or are gone upstream, and the skills that are new (never selected or declined).
 */
export const compareInstalled = async (
  key: string,
  entry: CollectionEntry,
  lock: Lock,
  traversal: Traversal,
): Promise<CollectionUpdate> => {
  const upstream = new Map(traversal.skills.map((skill) => [skill.name, skill]));

  const kept = await Promise.all(
    entry.selected.map((name): Promise<SkillUpdate | undefined> | SkillUpdate | undefined => {
      const locked = lock.skills[name];
      const after = upstream.get(name);

      if (locked === undefined) {
        return undefined;
      }

      const before = originOf(name, locked);

      return after === undefined
        ? { name, change: "removed", before, after }
        : compareKept(before, locked.computedHash, after);
    }),
  );

  const known = new Set([...entry.selected, ...entry.declined]);

  const fresh = traversal.skills.flatMap((after): SkillUpdate[] =>
    known.has(after.name) ? [] : [{ name: after.name, change: "new", before: undefined, after }],
  );

  return {
    key,
    name: traversal.name,
    before: entry.commit,
    after: traversal.commit,
    skills: [...present(kept), ...fresh].toSorted(byName),
  };
};

/**
 * Compare two Traversals of one Collection skill by skill: the reviewed one (what Consumers get)
 * and the upstream one (what a review would release).
 */
export const compareTraversals = async (before: Traversal, after: Traversal) => {
  const old = new Map(before.skills.map((skill) => [skill.name, skill]));
  const next = new Map(after.skills.map((skill) => [skill.name, skill]));
  const names = [...new Set([...old.keys(), ...next.keys()])].toSorted();

  const updates = await Promise.all(
    names.map(async (name): Promise<SkillUpdate | undefined> => {
      const was = old.get(name);
      const now = next.get(name);

      if (was === undefined) {
        return { name, change: "new", before: undefined, after: now };
      }

      if (now === undefined) {
        return { name, change: "removed", before: was, after: undefined };
      }

      return compareKept(was, await computeSkillHash(was.dir), now);
    }),
  );

  return present(updates);
};

/**
 * A folder holding the installed version of a skill: the installed copy while it still matches
 * the lock, else a checkout of the locked commit (so local edits don't show up as upstream changes).
 */
export const lockedSkillDir = async (
  scope: Scope,
  name: string,
  entry: SkillEntry,
  fetcher: Fetcher,
) => {
  const installed = installedDir(scope, name);

  if ((await hashIfPresent(installed)) === entry.computedHash) {
    return installed;
  }

  const checkout = await fetcher.checkoutCommit(entry, entry.commit);

  return join(checkout.root, entry.path);
};
