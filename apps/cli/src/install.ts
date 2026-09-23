import {
  applyPlan,
  executablesSummary,
  Fetcher,
  findCollection,
  formatSource,
  fromLockSource,
  parseSource,
  planInstall,
  readLock,
  ScillaError,
  traverse,
  type AuditReport,
  type Plan,
  type Scope,
  type Source,
} from "@scilla/core";
import type { InstallFlags } from "./args.ts";
import { reviewAudit, startAudit } from "./audit.ts";
import { scopeFor, type Io } from "./io.ts";
import { printOutcome, Reporter, shortCommit } from "./report.ts";

/** One `add` or `update` run: where it installs and the fetcher its Traversals share. */
interface Session {
  readonly io: Io;
  readonly flags: InstallFlags;
  readonly scope: Scope;
  readonly reporter: Reporter;
  readonly fetcher: Fetcher;
}

interface Picked {
  readonly plan: Plan;
  readonly selected: ReadonlySet<string>;
}

const session = (io: Io, flags: InstallFlags): Session => ({
  io,
  flags,
  scope: scopeFor(io, flags.global),
  reporter: new Reporter(io),
  fetcher: new Fetcher(io.cacheDir),
});

/** With `--yes` or without a terminal, the picker stays closed and the pre-ticked choices apply. */
const unattended = (current: Session) => current.flags.yes || !current.io.interactive;

/** Open the picker, which shows the ratings as they arrive; unattended, take the pre-ticked choices. */
const pick = (current: Session, plan: Plan, audit: Promise<AuditReport>) => {
  if (unattended(current)) {
    return Promise.resolve<ReadonlySet<string>>(
      new Set(plan.choices.flatMap((choice) => (choice.selected ? [choice.skill.name] : []))),
    );
  }

  return current.io.tui.pickSkills(plan, { audit });
};

const warnExecutables = (reporter: Reporter, plan: Plan, selected: ReadonlySet<string>) => {
  for (const { skill } of plan.choices) {
    if (selected.has(skill.name) && skill.executables.length > 0) {
      reporter.warn(
        `${skill.name} contains executable files: ${executablesSummary(skill.executables).join(", ")}`,
      );
    }
  }
};

/**
 * Traverse, pick and install one Collection; undefined when the pick (or the confirmation a risky
 * rating asks for) was cancelled. Ratings are fetched while the picker is open.
 */
const installFrom = async (current: Session, source: Source): Promise<Picked | undefined> => {
  const { io, reporter } = current;

  const traversal = await io.tui.withProgress(
    `Resolving ${formatSource(source)}`,
    () => traverse(source, current.fetcher, { home: io.home }),
    io.stderr,
  );

  const lock = await readLock(current.scope);
  const plan = planInstall(traversal, lock, current.flags.all);
  const ratings = startAudit(io, traversal.skills, current.flags.audit);
  const selected = await pick(current, plan, ratings);

  if (selected === undefined) {
    return undefined;
  }

  const ticked = plan.choices.flatMap(({ skill }) =>
    selected.has(skill.name) ? [skill.name] : [],
  );

  if (!(await reviewAudit(io, reporter, ratings, ticked, !unattended(current)))) {
    return undefined;
  }

  warnExecutables(reporter, plan, selected);

  // An unattended run decides nothing, so skills it leaves out stay undecided (and announced).
  const outcome = await applyPlan(current.scope, lock, plan, selected, {
    force: current.flags.force,
    decide: !unattended(current),
  });

  reporter.line(`${traversal.name} (${plan.key}) at ${shortCommit(traversal.commit)}`);
  reporter.warnAll(traversal.warnings, current.fetcher.details);
  printOutcome(reporter, outcome);

  return { plan, selected };
};

/** `scilla add <source>`. */
export const add = async (io: Io, raw: string, flags: InstallFlags) => {
  const current = session(io, flags);
  const picked = await installFrom(current, parseSource(raw, io.cwd, io.home));

  if (picked === undefined) {
    current.reporter.line("Cancelled.");
  }
};

const quoted = (name: string) => (/\s/.test(name) ? JSON.stringify(name) : name);

const reportNew = (current: Session, { plan, selected }: Picked) => {
  const fresh = plan.choices.flatMap((choice) =>
    choice.status === "new" && !selected.has(choice.skill.name) ? [choice.skill.name] : [],
  );

  if (fresh.length > 0 && unattended(current)) {
    current.reporter.line(
      `${fresh.length} new skill(s) available: ${fresh.join(", ")} (run scilla update ${quoted(plan.traversal.name)} to pick)`,
    );
  }
};

/** Update one installed Collection from the lock as it is now; true when the pick was cancelled. */
const updateOne = async (current: Session, key: string) => {
  const entry = (await readLock(current.scope)).collections[key];

  if (entry === undefined) {
    return false;
  }

  const picked = await installFrom(current, fromLockSource(entry.source));

  if (picked === undefined) {
    return true;
  }

  reportNew(current, picked);

  return false;
};

const collectionKeys = async (current: Session, query: string | undefined) => {
  const lock = await readLock(current.scope);

  if (query === undefined) {
    return Object.keys(lock.collections).toSorted();
  }

  const key = findCollection(lock, query);

  if (key === undefined) {
    throw new ScillaError(`Collection "${query}" is not installed.`);
  }

  return [key];
};

/** `scilla update [collection]`: one Collection at a time, each reading the lock the last one wrote. */
export const update = async (io: Io, query: string | undefined, flags: InstallFlags) => {
  const current = session(io, flags);
  const keys = await collectionKeys(current, query);

  if (keys.length === 0) {
    current.reporter.line("No Collections installed.");

    return;
  }

  const cancelled = await keys.reduce(
    async (previous, key) => (await previous) || updateOne(current, key),
    Promise.resolve(false),
  );

  if (cancelled) {
    current.reporter.line("Cancelled.");
  }
};
