import {
  deleteCollection,
  deleteSkill,
  findCollection,
  readLock,
  ScillaError,
  type CollectionEntry,
  type Lock,
  type SkillEntry,
} from "@scilla/core";
import type { InstallFlags } from "./args.ts";
import { scopeFor, type Io } from "./io.ts";
import { printOutcome, Reporter, shortCommit, where } from "./report.ts";

/** `scilla delete <collection|skill>`: a Collection by key or name first, then a skill name. */
export const remove = async (io: Io, target: string, flags: InstallFlags) => {
  const scope = scopeFor(io, flags.global);
  const lock = await readLock(scope);
  const reporter = new Reporter(io);
  const key = findCollection(lock, target);

  if (key !== undefined) {
    reporter.line(`Deleting Collection ${lock.collections[key]?.name ?? key} (${key})`);
    printOutcome(reporter, await deleteCollection(scope, lock, key, flags.force));

    return;
  }

  if (target in lock.skills) {
    reporter.line(`Deleting skill ${target}`);
    printOutcome(reporter, await deleteSkill(scope, lock, target, flags.force));

    return;
  }

  throw new ScillaError(`No Collection or skill "${target}" is installed ${where(flags.global)}.`);
};

// A repo without a manifest is named after its source, so its key would only repeat the name.
const collectionLines = (key: string, entry: CollectionEntry) => [
  `${entry.name === key ? key : `${entry.name}  ${key}`}  ${shortCommit(entry.commit)}`,
  ...entry.selected.map((name) => `  ${name}`),
];

/** A skill no installed Collection claims (for example, one whose Collection was edited by hand). */
const isLoose = (lock: Lock, entry: SkillEntry) =>
  !entry.collections.some((key) => key in lock.collections);

/** `scilla list [-g]`: each Collection with its source and commit, then its selected skills. */
export const list = async (io: Io, global: boolean) => {
  const lock = await readLock(scopeFor(io, global));
  const reporter = new Reporter(io);

  const collections = Object.entries(lock.collections)
    .toSorted(([a], [b]) => a.localeCompare(b))
    .flatMap(([key, entry]) => collectionLines(key, entry));

  const loose = Object.entries(lock.skills)
    .flatMap(([name, entry]) => (isLoose(lock, entry) ? [`  ${name}`] : []))
    .toSorted();

  const lines = [
    ...collections,
    ...(loose.length === 0 ? [] : ["Skills in no Collection:", ...loose]),
  ];

  if (lines.length === 0) {
    reporter.line(`Nothing installed ${where(global)}.`);
  }

  for (const text of lines) {
    reporter.line(text);
  }
};
