import { ManifestError, ScillaError, SourceError } from "@scilla/core";
import packageJson from "../package.json" with { type: "json" };
import { HELP, parseCommand, UsageError, type Command } from "./args.ts";
import { audit } from "./audit.ts";
import { check, init, refAdd, skillNew } from "./curator.ts";
import { diff } from "./diff.ts";
import { docs } from "./docs.ts";
import { home } from "./home.ts";
import { add, update } from "./install.ts";
import type { Io } from "./io.ts";
import { list, remove } from "./manage.ts";
import { outdated } from "./outdated.ts";
import { indented } from "./report.ts";
import { install } from "./restore.ts";
import { accept, propose } from "./review.ts";

/** A command's exit code; commands that only succeed or throw resolve with nothing (0). */
type Exit = Promise<number | void>;

type CuratorCommand = Extract<
  Command,
  { kind: "init" | "ref-add" | "skill-new" | "check" | "review-accept" | "review-propose" }
>;

const runCurator = (command: CuratorCommand, io: Io): Exit => {
  switch (command.kind) {
    case "init": {
      return init(io, command.name, command.description);
    }

    case "ref-add": {
      return refAdd(io, command);
    }

    case "skill-new": {
      return skillNew(io, command.name);
    }

    case "check": {
      return check(io, command.dir);
    }

    case "review-accept": {
      return accept(io, command.reference);
    }

    case "review-propose": {
      return propose(io, command);
    }
  }
};

type ConsumerCommand = Extract<
  Command,
  { kind: "add" | "update" | "delete" | "install" | "outdated" | "diff" | "list" | "audit" }
>;

const runConsumer = (command: ConsumerCommand, io: Io): Exit => {
  switch (command.kind) {
    case "add": {
      return add(io, command.source, command.flags);
    }

    case "update": {
      return update(io, command.collection, command.flags);
    }

    case "delete": {
      return remove(io, command.target, command.flags);
    }

    case "install": {
      return install(io, command);
    }

    case "outdated": {
      return outdated(io, command.global);
    }

    case "diff": {
      return diff(io, command);
    }

    case "list": {
      return list(io, command.global);
    }

    case "audit": {
      return audit(io, command.global, command.enabled);
    }
  }
};

const CURATOR_KINDS: ReadonlySet<Command["kind"]> = new Set([
  "init",
  "ref-add",
  "skill-new",
  "check",
  "review-accept",
  "review-propose",
]);

const isCurator = (command: Command): command is CuratorCommand => CURATOR_KINDS.has(command.kind);

const run = async (command: Command, io: Io): Exit => {
  switch (command.kind) {
    case "help": {
      io.stdout.write(HELP);

      return;
    }

    case "version": {
      io.stdout.write(`${packageJson.version}\n`);

      return;
    }

    case "home": {
      return home(io, (next) => run(next, io));
    }

    case "docs": {
      docs(io, command.topic, command.raw);

      return;
    }

    default: {
      return isCurator(command) ? runCurator(command, io) : runConsumer(command, io);
    }
  }
};

/** What `SCILLA_DEBUG` adds under an error: an expected failure's detail, or another error's stack. */
const debugText = (cause: unknown) => {
  if (cause instanceof ScillaError) {
    return cause.detail === undefined ? undefined : indented(cause.detail);
  }

  return cause instanceof Error ? `${cause.stack ?? ""}\n` : undefined;
};

/** The docs topic that explains how to fix an error, if one does. */
const topicFor = (cause: unknown) => {
  if (cause instanceof SourceError) {
    return "sources";
  }

  if (cause instanceof ManifestError) {
    return "manifest";
  }

  return cause instanceof UsageError ? "commands" : undefined;
};

/**
 * Expected failures print their message, and a docs topic when one explains the fix;
 * `SCILLA_DEBUG` adds their detail or a stack.
 */
const fail = (io: Io, cause: unknown) => {
  const message = cause instanceof Error ? cause.message : String(cause);
  const debug = io.debug ? debugText(cause) : undefined;
  const topic = topicFor(cause);

  io.stderr.write(`error: ${message}\n`);

  if (topic !== undefined) {
    io.stderr.write(`see: scilla docs ${topic}\n`);
  }

  if (debug !== undefined) {
    io.stderr.write(debug);
  }

  return 1;
};

/** Run the CLI with `argv` (without the runtime and script); resolves with the exit code. */
export const main = async (argv: readonly string[], io: Io): Promise<number> => {
  try {
    return (await run(parseCommand(argv), io)) ?? 0;
  } catch (cause) {
    return fail(io, cause);
  }
};
