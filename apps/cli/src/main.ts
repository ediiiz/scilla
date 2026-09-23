import { ManifestError, ScillaError, SourceError } from "@scilla/core";
import packageJson from "../package.json" with { type: "json" };
import { HELP, parseCommand, UsageError, type Command } from "./args.ts";
import { audit } from "./audit.ts";
import { check, init, refAdd, skillNew } from "./curator.ts";
import { docs } from "./docs.ts";
import { home } from "./home.ts";
import { add, update } from "./install.ts";
import type { Io } from "./io.ts";
import { list, remove } from "./manage.ts";
import { indented } from "./report.ts";

type CuratorCommand = Extract<Command, { kind: "init" | "ref-add" | "skill-new" | "check" }>;

const runCurator = (command: CuratorCommand, io: Io): Promise<void> => {
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
  }
};

type ConsumerCommand = Extract<Command, { kind: "add" | "update" | "delete" | "list" | "audit" }>;

const runConsumer = (command: ConsumerCommand, io: Io): Promise<void> => {
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

    case "list": {
      return list(io, command.global);
    }

    case "audit": {
      return audit(io, command.global, command.enabled);
    }
  }
};

const run = async (command: Command, io: Io): Promise<void> => {
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

    case "init":
    case "ref-add":
    case "skill-new":
    case "check": {
      return runCurator(command, io);
    }

    default: {
      return runConsumer(command, io);
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
    await run(parseCommand(argv), io);

    return 0;
  } catch (cause) {
    return fail(io, cause);
  }
};
