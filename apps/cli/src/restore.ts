import {
  checkInstalled,
  Fetcher,
  readLock,
  restoreLock,
  type Lock,
  type Scope,
} from "@scilla/core";
import type { InstallCommand } from "./args.ts";
import { scopeFor, type Io } from "./io.ts";
import { printOutcome, Reporter, where } from "./report.ts";

/** Compare the installed skills with the lock; prints what differs and returns how many do. */
const reportDrift = async (reporter: Reporter, scope: Scope, lock: Lock) => {
  const drift = await checkInstalled(scope, lock);

  const lines = [
    drift.missing.length === 0 ? [] : [`Missing: ${drift.missing.join(", ")}`],
    drift.modified.length === 0 ? [] : [`Modified: ${drift.modified.join(", ")}`],
    drift.extra.length === 0
      ? []
      : [`Extra: ${drift.extra.join(", ")} (in .agents/skills, but in no lock)`],
  ].flat();

  for (const text of lines) {
    reporter.line(text);
  }

  return drift.missing.length + drift.modified.length + drift.extra.length;
};

const mismatch = (io: Io, count: number, after: string) => {
  io.stderr.write(`error: ${count} skill(s) don't match scilla-lock.json${after}.\n`);

  return 1;
};

/**
 * `scilla install [-g] [--frozen] [--check] [--force]`: install exactly what the lock records,
 * never resolving anything upstream. Skills that fail are errors; the others still install.
 */
export const install = async (io: Io, command: InstallCommand) => {
  const scope = scopeFor(io, command.global);
  const lock = await readLock(scope);
  const reporter = new Reporter(io);

  if (Object.keys(lock.skills).length === 0) {
    reporter.line(`Nothing to install: no scilla-lock.json with skills ${where(command.global)}.`);

    return 0;
  }

  if (command.check) {
    const count = await reportDrift(reporter, scope, lock);

    if (count === 0) {
      reporter.line("Everything installed matches scilla-lock.json.");
    }

    return count === 0 ? 0 : mismatch(io, count, "");
  }

  const fetcher = new Fetcher(io.cacheDir);

  const restore = await io.tui.withProgress(
    "Installing from scilla-lock.json",
    () => restoreLock(scope, lock, fetcher, { force: command.force }),
    io.stderr,
  );

  printOutcome(reporter, restore);

  for (const failure of restore.failed) {
    io.stderr.write(`error: Can't install ${failure.name}: ${failure.reason}\n`);
  }

  const drifted = command.frozen ? await reportDrift(reporter, scope, lock) : 0;

  if (drifted > 0) {
    return mismatch(io, drifted, " after the install (--frozen)");
  }

  return restore.failed.length === 0 ? 0 : 1;
};
