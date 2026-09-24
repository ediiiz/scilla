import { existsSync } from "node:fs";
import { ScillaError } from "./errors.ts";
import { computeSkillHash } from "./hash.ts";
import {
  installedDir,
  installedHash,
  installSkillFiles,
  linkSkill,
  removeSkillFiles,
} from "./install.ts";
import {
  syncSkillsLock,
  toLockSource,
  writeLock,
  type AgentLinks,
  type Lock,
  type Scope,
} from "./lock.ts";
import { formatSource, githubRepo } from "./source.ts";
import type { ResolvedSkill, Traversal } from "./traversal.ts";

/**
 * How a skill relates to what's installed:
 * - `available`: offered for the first time by a Collection that isn't installed yet
 * - `installed`: selected earlier (or installed through another Collection from the same origin)
 * - `new`: appeared upstream since the last install; must be opted into
 * - `declined`: seen earlier and not selected
 * - `conflict`: a skill of that name is installed from a different origin
 */
export type ChoiceStatus = "available" | "installed" | "new" | "declined" | "conflict";

export interface Choice {
  readonly skill: ResolvedSkill;
  readonly status: ChoiceStatus;
  /** Pre-ticked in the picker. */
  readonly selected: boolean;
  readonly note: string | undefined;
  /** An installed skill whose files upstream differ from the lock's (see `markChanged`). */
  readonly changed?: boolean | undefined;
}

export interface Plan {
  readonly traversal: Traversal;
  /** The Collection's key in the lock. */
  readonly key: string;
  readonly choices: readonly Choice[];
  /** Skills installed from this Collection that are gone upstream. */
  readonly removed: readonly string[];
}

export interface Outcome {
  readonly installed: string[];
  readonly updated: string[];
  readonly unchanged: string[];
  readonly removed: string[];
  readonly skipped: { readonly name: string; readonly reason: string }[];
  readonly warnings: string[];
}

const LOCAL_EDITS = "has local edits (use --force to overwrite)";

const FOREIGN = "a skill of that name exists but scilla didn't install it";

// A claim that no real Collection key can equal (keys are formatted sources).
const DELETED = "\0delete";

const emptyOutcome = (): Outcome => ({
  installed: [],
  updated: [],
  unchanged: [],
  removed: [],
  skipped: [],
  warnings: [],
});

const choose = (
  status: ChoiceStatus,
  selected: boolean,
  skill: ResolvedSkill,
  note?: string,
): Choice => ({ skill, status, selected, note });

const choiceFor = (skill: ResolvedSkill, lock: Lock, key: string, all: boolean): Choice => {
  const existing = lock.skills[skill.name];

  if (existing !== undefined && (existing.url !== skill.url || existing.path !== skill.path)) {
    return choose("conflict", false, skill, `already installed from ${existing.url}`);
  }

  const previous = lock.collections[key];

  if (previous === undefined) {
    return existing === undefined
      ? choose("available", all || !skill.optional, skill)
      : choose("installed", true, skill);
  }

  if (previous.selected.includes(skill.name)) {
    return choose("installed", true, skill);
  }

  return previous.declined.includes(skill.name)
    ? choose("declined", all, skill)
    : choose("new", all, skill);
};

/** Work out what the picker should offer for a traversed Collection, given what's installed. */
export const planInstall = (traversal: Traversal, lock: Lock, all = false): Plan => {
  const key = formatSource(traversal.source);
  const available = new Set(traversal.skills.map((skill) => skill.name));
  const previous = lock.collections[key]?.selected ?? [];

  return {
    traversal,
    key,
    choices: traversal.skills.map((skill) => choiceFor(skill, lock, key, all)),
    removed: previous.filter((name) => !available.has(name)),
  };
};

/**
 * Mark the installed choices whose upstream files differ from what the lock recorded, so the
 * picker can say which skills an update changes. Other choices are left as they are.
 */
export const markChanged = async (plan: Plan, lock: Lock): Promise<Plan> => {
  const choices = await Promise.all(
    plan.choices.map(async (choice) => {
      const entry = lock.skills[choice.skill.name];

      if (choice.status !== "installed" || entry === undefined) {
        return choice;
      }

      return {
        ...choice,
        changed: (await computeSkillHash(choice.skill.dir)) !== entry.computedHash,
      };
    }),
  );

  return { ...plan, choices };
};

const union = (list: readonly string[] | undefined, item: string) =>
  [...new Set([...(list ?? []), item])].toSorted();

const sorted = (outcome: Outcome): Outcome => ({
  installed: outcome.installed.toSorted(),
  updated: outcome.updated.toSorted(),
  unchanged: outcome.unchanged.toSorted(),
  removed: outcome.removed.toSorted(),
  skipped: outcome.skipped.toSorted((a, b) => a.name.localeCompare(b.name)),
  warnings: outcome.warnings,
});

/** Applies installs and removals to a working copy of the lock, collecting what happened. */
class Applier {
  readonly outcome = emptyOutcome();

  readonly #scope: Scope;

  readonly #lock: Lock;

  readonly #force: boolean;

  constructor(scope: Scope, lock: Lock, force: boolean) {
    this.#scope = scope;
    this.#lock = lock;
    this.#force = force;
  }

  #hasLocalEdits = async (name: string, expected: string) => {
    const current = await installedHash(this.#scope, name);

    return current !== undefined && current !== expected && !this.#force;
  };

  /** Install or refresh one skill; returns false when it was skipped and isn't installed. */
  async install(skill: ResolvedSkill, key: string) {
    const { name } = skill;
    const existing = this.#lock.skills[name];

    if (existing === undefined && existsSync(installedDir(this.#scope, name)) && !this.#force) {
      this.outcome.skipped.push({ name, reason: FOREIGN });

      return false;
    }

    if (existing !== undefined && (await this.#hasLocalEdits(name, existing.computedHash))) {
      this.outcome.skipped.push({ name, reason: LOCAL_EDITS });
      this.#lock.skills[name] = { ...existing, collections: union(existing.collections, key) };

      return true;
    }

    const computedHash = await computeSkillHash(skill.dir);

    const unchanged =
      existing !== undefined && (await installedHash(this.#scope, name)) === computedHash;

    // An unchanged skill still gets linked, in case the Consumer just said yes to an agent.
    this.outcome.warnings.push(
      ...(unchanged
        ? await linkSkill(this.#scope, name, this.#lock.agentLinks)
        : await installSkillFiles(this.#scope, name, skill.dir, this.#lock.agentLinks)),
    );

    this.#lock.skills[name] = {
      collections: union(existing?.collections, key),
      kind: skill.kind,
      url: skill.url,
      path: skill.path,
      commit: skill.commit,
      computedHash,
      optional: skill.optional,
    };
    this.#record(name, existing === undefined, unchanged);

    return true;
  }

  #record(name: string, fresh: boolean, unchanged: boolean) {
    if (unchanged) {
      this.outcome.unchanged.push(name);
    } else if (fresh) {
      this.outcome.installed.push(name);
    } else {
      this.outcome.updated.push(name);
    }
  }

  /** Drop `key`'s claim on a skill, removing it once no Collection claims it; false when kept for local edits. */
  async release(name: string, key: string) {
    const entry = this.#lock.skills[name];

    if (entry === undefined) {
      return true;
    }

    const others = entry.collections.filter((collection) => collection !== key);

    if (others.length > 0) {
      this.#lock.skills[name] = { ...entry, collections: others };

      return true;
    }

    if (await this.#hasLocalEdits(name, entry.computedHash)) {
      this.outcome.skipped.push({ name, reason: `${LOCAL_EDITS}; kept` });

      return false;
    }

    await removeSkillFiles(this.#scope, name);
    delete this.#lock.skills[name];
    this.outcome.removed.push(name);

    return true;
  }

  /** Release each name from `key`; returns the names kept because of local edits. */
  async releaseAll(names: readonly string[], key: string) {
    const released = await Promise.all(names.map((name) => this.release(name, key)));

    return names.filter((_, index) => released[index] === false);
  }

  async save() {
    await writeLock(this.#scope, this.#lock);
    this.outcome.warnings.push(
      ...(await syncSkillsLock(this.#scope, this.#lock, this.outcome.removed)),
    );

    return sorted(this.outcome);
  }
}

/** Install the ticked choices; returns the names now installed for this Collection. */
const installChoices = async (applier: Applier, plan: Plan, selected: ReadonlySet<string>) => {
  const ticked = plan.choices.filter((choice) => selected.has(choice.skill.name));

  const installed = await Promise.all(
    ticked.map(async (choice) => {
      if (choice.status === "conflict") {
        applier.outcome.skipped.push({
          name: choice.skill.name,
          reason: choice.note ?? "name clash",
        });

        return false;
      }

      return applier.install(choice.skill, plan.key);
    }),
  );

  return ticked.flatMap((choice, index) => (installed[index] === true ? [choice.skill.name] : []));
};

export interface ApplyOptions {
  /** Overwrite local edits and folders scilla didn't install. */
  readonly force?: boolean;
  /**
   * Whether `selected` is the Consumer's decision (the picker was used). When false (`--yes`, no
   * TTY), skills nobody decided on (`new`, or recommended `available` ones that weren't installed)
   * stay undecided instead of being recorded as declined, so later updates still offer them.
   */
  readonly decide?: boolean;
  /** The Consumer's answers on linking into agent folders, recorded in the lock before installing. */
  readonly agentLinks?: AgentLinks | undefined;
}

/** A choice left unticked without the Consumer deciding it: it stays out of `declined`. */
const undecided = (choice: Choice) =>
  choice.status === "new" || (choice.status === "available" && !choice.skill.optional);

/** Install the `selected` skill names from a plan, release deselected ones, and write the locks. */
export const applyPlan = async (
  scope: Scope,
  lock: Lock,
  plan: Plan,
  selected: ReadonlySet<string>,
  { force = false, decide = true, agentLinks }: ApplyOptions = {},
): Promise<Outcome> => {
  const next = structuredClone(lock);

  if (agentLinks !== undefined) {
    next.agentLinks = { ...next.agentLinks, ...agentLinks };
  }

  const applier = new Applier(scope, next, force);
  const kept = new Set(await installChoices(applier, plan, selected));
  const dropped = (next.collections[plan.key]?.selected ?? []).filter((name) => !kept.has(name));

  for (const name of await applier.releaseAll(dropped, plan.key)) {
    kept.add(name);
  }

  if (kept.size === 0) {
    delete next.collections[plan.key];
  } else {
    next.collections[plan.key] = {
      name: plan.traversal.name,
      source: toLockSource(plan.traversal.source),
      commit: plan.traversal.commit,
      selected: [...kept].toSorted(),
      declined: plan.choices
        .flatMap((choice) =>
          kept.has(choice.skill.name) || (!decide && undecided(choice)) ? [] : [choice.skill.name],
        )
        .toSorted(),
    };
  }

  return applier.save();
};

/**
 * Find a Collection in the lock by its source key or (case-insensitively) its name. A github.com
 * https URL finds the Collection keyed by its `owner/repo`.
 */
export const findCollection = (lock: Lock, query: string) => {
  const key = githubRepo(query) ?? query;

  if (key in lock.collections) {
    return key;
  }

  const wanted = query.toLowerCase();

  return Object.entries(lock.collections).find(
    ([, entry]) => entry.name.toLowerCase() === wanted,
  )?.[0];
};

/** Remove a whole Collection; skills another Collection also installed stay. */
export const deleteCollection = async (scope: Scope, lock: Lock, key: string, force = false) => {
  const next = structuredClone(lock);
  const entry = next.collections[key];

  if (entry === undefined) {
    throw new ScillaError(`Collection "${key}" is not installed.`);
  }

  const applier = new Applier(scope, next, force);
  const kept = await applier.releaseAll(entry.selected, key);

  if (kept.length === 0) {
    delete next.collections[key];
  } else {
    next.collections[key] = { ...entry, selected: kept };
  }

  return applier.save();
};

/**
 * Remove one skill and record it as declined in every Collection that had it, so `update` doesn't
 * bring it back. A Collection left with nothing selected stays in the lock to remember that.
 */
export const deleteSkill = async (scope: Scope, lock: Lock, name: string, force = false) => {
  const next = structuredClone(lock);
  const entry = next.skills[name];

  if (entry === undefined) {
    throw new ScillaError(`Skill "${name}" was not installed by scilla.`);
  }

  const applier = new Applier(scope, next, force);

  // One claim left means release removes the files (unless they have local edits).
  next.skills[name] = { ...entry, collections: [DELETED] };

  if (!(await applier.release(name, DELETED))) {
    return sorted(applier.outcome);
  }

  for (const key of entry.collections) {
    const collection = next.collections[key];

    if (collection !== undefined) {
      const selected = collection.selected.filter((skill) => skill !== name);

      next.collections[key] = {
        ...collection,
        selected,
        declined: union(collection.declined, name),
      };
    }
  }

  return applier.save();
};
