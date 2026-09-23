import { readLock, readManifest } from "@scilla/core";
import type { HomeAction } from "@scilla/tui";
import { HELP, type Command, type InstallFlags } from "./args.ts";
import { scopeFor, type Io } from "./io.ts";

const tuiFlags = (global: boolean): InstallFlags => ({
  global,
  yes: false,
  all: false,
  force: false,
  audit: true,
});

/** The command a home screen action stands for; it runs through the same handlers as the CLI. */
export const commandFor = (action: HomeAction): Command => {
  switch (action.kind) {
    case "add": {
      return { kind: "add", source: action.source, flags: tuiFlags(false) };
    }

    case "update": {
      return { kind: "update", collection: action.collection, flags: tuiFlags(action.global) };
    }

    case "delete": {
      return { kind: "delete", target: action.collection, flags: tuiFlags(action.global) };
    }

    case "init": {
      return { kind: "init", name: action.name, description: action.description };
    }

    case "ref-add": {
      return {
        kind: "ref-add",
        source: action.source,
        optional: false,
        include: [],
        exclude: [],
        verify: true,
      };
    }

    case "skill-new": {
      return { kind: "skill-new", name: action.name };
    }

    case "check": {
      return { kind: "check", dir: undefined };
    }
  }
};

/** Bare `scilla`: the home screen on a terminal, otherwise the help text. */
export const home = async (io: Io, run: (command: Command) => Promise<void>) => {
  if (!io.interactive) {
    io.stdout.write(HELP);

    return;
  }

  const [project, global, manifest] = await Promise.all([
    readLock(scopeFor(io, false)),
    readLock(scopeFor(io, true)),
    readManifest(io.cwd),
  ]);

  const action = await io.tui.runHome({
    project,
    global,
    isCollection: manifest !== undefined,
    collectionName: manifest?.name,
  });

  if (action !== undefined) {
    await run(commandFor(action));
  }
};
