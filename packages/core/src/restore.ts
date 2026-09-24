import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Outcome } from "./consumer.ts";
import { ScillaError } from "./errors.ts";
import type { Fetcher } from "./fetch.ts";
import { hashIfPresent } from "./hash.ts";
import { installedHash, installSkillFiles, linkSkill } from "./install.ts";
import {
  skillsDir,
  skillsLockNames,
  syncSkillsLock,
  type AgentLinks,
  type Lock,
  type Scope,
  type SkillEntry,
} from "./lock.ts";

/** A skill the lock lists that couldn't be installed, and why. */
export interface Failure {
  readonly name: string;
  readonly reason: string;
}

/** What `scilla install` did: an `Outcome` (nothing is ever removed) plus the skills that failed. */
export interface Restore extends Outcome {
  readonly failed: Failure[];
}

export interface RestoreOptions {
  /** Overwrite installed folders whose files differ from the lock. */
  readonly force?: boolean;
}

const DIFFERS =
  "its files differ from the lock: local edits, or another version (use --force to overwrite)";

type Step =
  | { readonly kind: "installed" | "updated"; readonly warnings: readonly string[] }
  | { readonly kind: "unchanged"; readonly warnings?: readonly string[] }
  | { readonly kind: "skipped" | "failed"; readonly reason: string };

interface Context {
  readonly scope: Scope;
  readonly agentLinks: AgentLinks | undefined;
  readonly fetcher: Fetcher;
  readonly force: boolean;
}

/** Copy the locked files into place, once they're shown to be the ones the lock hashed. */
const installLocked = async (context: Context, name: string, entry: SkillEntry, fresh: boolean) => {
  const short = entry.commit.slice(0, 7);
  const checkout = await context.fetcher.checkoutCommit(entry, entry.commit);
  const dir = join(checkout.root, entry.path);
  const hash = await hashIfPresent(dir);

  if (hash === undefined) {
    return {
      kind: "failed",
      reason: `${entry.path === "" ? "." : entry.path} is missing at ${short}`,
    } as const;
  }

  if (hash !== entry.computedHash) {
    return {
      kind: "failed",
      reason: `its files at ${short} don't match the lock's computedHash`,
    } as const;
  }

  const warnings = await installSkillFiles(context.scope, name, dir, context.agentLinks);

  return { kind: fresh ? "installed" : "updated", warnings } as const;
};

const restoreSkill = async (context: Context, name: string, entry: SkillEntry): Promise<Step> => {
  const current = await installedHash(context.scope, name);

  if (current === entry.computedHash) {
    // Linked anyway, so a teammate gets the links the lock asks for on an existing install.
    return {
      kind: "unchanged",
      warnings: await linkSkill(context.scope, name, context.agentLinks),
    };
  }

  if (current !== undefined && !context.force) {
    return { kind: "skipped", reason: DIFFERS };
  }

  try {
    return await installLocked(context, name, entry, current === undefined);
  } catch (cause) {
    if (cause instanceof ScillaError) {
      return { kind: "failed", reason: cause.message };
    }

    throw cause;
  }
};

const record = (restore: Restore, name: string, step: Step) => {
  switch (step.kind) {
    case "skipped": {
      restore.skipped.push({ name, reason: step.reason });

      return;
    }

    case "failed": {
      restore.failed.push({ name, reason: step.reason });

      return;
    }

    case "unchanged": {
      restore.unchanged.push(name);
      restore.warnings.push(...(step.warnings ?? []));

      return;
    }

    default: {
      restore[step.kind].push(name);
      restore.warnings.push(...step.warnings);
    }
  }
};

/**
 * Install exactly what the lock records: every skill it lists, at its locked commit, never
 * resolving anything upstream. Each copy is checked against the lock's `computedHash` before it is
 * installed. A folder whose files differ from the lock is skipped unless `force`; a skill whose
 * commit is gone upstream fails on its own while the others go on. The lock itself is not written.
 */
export const restoreLock = async (
  scope: Scope,
  lock: Lock,
  fetcher: Fetcher,
  { force = false }: RestoreOptions = {},
): Promise<Restore> => {
  const context = { scope, fetcher, force, agentLinks: lock.agentLinks };
  const names = Object.keys(lock.skills).toSorted();

  const steps = await Promise.all(
    names.map((name) => {
      const entry = lock.skills[name];

      return entry === undefined
        ? { kind: "unchanged" as const }
        : restoreSkill(context, name, entry);
    }),
  );

  const restore: Restore = {
    installed: [],
    updated: [],
    unchanged: [],
    removed: [],
    skipped: [],
    failed: [],
    warnings: [...fetcher.warnings],
  };

  for (const [index, name] of names.entries()) {
    const step = steps[index];

    if (step !== undefined) {
      record(restore, name, step);
    }
  }

  restore.warnings.push(...(await syncSkillsLock(scope, lock, [])));

  return restore;
};

/** How the installed skills differ from the lock. */
export interface Drift {
  /** In the lock, but not installed. */
  readonly missing: readonly string[];
  /** Installed, but the files don't hash to the lock's `computedHash`. */
  readonly modified: readonly string[];
  /** Project only: folders in `.agents/skills` that no lock lists (scilla's or the skills CLI's). */
  readonly extra: readonly string[];
}

const installedFolders = async (scope: Scope) => {
  const dir = skillsDir(scope);

  if (!existsSync(dir)) {
    return [];
  }

  const entries = await readdir(dir, { withFileTypes: true });

  return entries.flatMap((entry) => (entry.isDirectory() ? [entry.name] : []));
};

/**
 * Compare what's installed with the lock, installing nothing. Extra folders are only looked for in
 * a project: the home folder is shared with other tools that install skills without a lock there.
 */
export const checkInstalled = async (scope: Scope, lock: Lock): Promise<Drift> => {
  const names = Object.keys(lock.skills).toSorted();
  const hashes = await Promise.all(names.map((name) => installedHash(scope, name)));

  const missing = names.filter((_, index) => hashes[index] === undefined);

  const modified = names.filter((name, index) => {
    const hash = hashes[index];

    return hash !== undefined && hash !== lock.skills[name]?.computedHash;
  });

  if (scope.global) {
    return { missing, modified, extra: [] };
  }

  const known = new Set([...names, ...(await skillsLockNames(scope))]);
  const extra = (await installedFolders(scope)).filter((name) => !known.has(name)).toSorted();

  return { missing, modified, extra };
};
