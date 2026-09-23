import { parseArgs } from "node:util";
import { PROVIDERS, ScillaError } from "@scilla/core";
import { z } from "zod";

/** Flags shared by the commands that install or remove skills. */
export interface InstallFlags {
  readonly global: boolean;
  readonly yes: boolean;
  readonly all: boolean;
  readonly force: boolean;
  /** Fetch security ratings before installing; `--no-audit` turns it off. */
  readonly audit: boolean;
}

/** `scilla ref add`: a Reference source and the options that make it an object entry. */
export interface RefAddCommand {
  readonly kind: "ref-add";
  readonly source: string;
  readonly optional: boolean;
  readonly include: readonly string[];
  readonly exclude: readonly string[];
  /** Check that a git source answers (`git ls-remote`); `--no-verify` skips it. */
  readonly verify: boolean;
}

/** `scilla install`: restore the lock, or with `check` only compare it with what's installed. */
export interface InstallCommand {
  readonly kind: "install";
  readonly global: boolean;
  readonly force: boolean;
  /** Fail when the installed skills still differ from the lock afterwards. */
  readonly frozen: boolean;
  /** Install nothing; report how the installed skills differ from the lock. */
  readonly check: boolean;
}

/** `scilla diff [collection|skill]`. */
export interface DiffCommand {
  readonly kind: "diff";
  readonly target: string | undefined;
  readonly global: boolean;
  readonly raw: boolean;
  readonly audit: boolean;
}

/** `scilla review propose`: commit the reviewed-commit bumps, then print or open the pull request. */
export interface ProposeCommand {
  readonly kind: "review-propose";
  readonly open: boolean;
  readonly provider: (typeof PROVIDERS)[number] | undefined;
  readonly titleFile: string | undefined;
  readonly bodyFile: string | undefined;
  readonly audit: boolean;
}

/** A parsed command line. */
export type Command =
  | { readonly kind: "help" }
  | { readonly kind: "version" }
  | { readonly kind: "home" }
  | { readonly kind: "add"; readonly source: string; readonly flags: InstallFlags }
  | {
      readonly kind: "update";
      readonly collection: string | undefined;
      readonly flags: InstallFlags;
    }
  | { readonly kind: "delete"; readonly target: string; readonly flags: InstallFlags }
  | InstallCommand
  | { readonly kind: "outdated"; readonly global: boolean }
  | DiffCommand
  | { readonly kind: "list"; readonly global: boolean }
  | { readonly kind: "audit"; readonly global: boolean; readonly enabled: boolean }
  | { readonly kind: "docs"; readonly topic: string | undefined; readonly raw: boolean }
  | {
      readonly kind: "init";
      readonly name: string | undefined;
      readonly description: string | undefined;
    }
  | RefAddCommand
  | { readonly kind: "skill-new"; readonly name: string }
  | { readonly kind: "review-accept"; readonly reference: string | undefined }
  | ProposeCommand
  | { readonly kind: "check"; readonly dir: string | undefined };

export const HELP = `scilla: install curated Collections of agent skills

Usage:
  scilla                                  Home screen (on a terminal)
  scilla add <source> [-g] [-y] [--all]   Traverse a Collection, pick skills, install
  scilla update [collection] [-g] [-y] [--force]
                                          Re-traverse installed Collections
  scilla delete <collection|skill> [-g] [--force]
                                          Remove a Collection or one skill (alias: remove)
  scilla install [-g] [--frozen] [--check] [--force]
                                          Install exactly what scilla-lock.json records
  scilla outdated [-g]                    What an update would change (exit 10 if anything)
  scilla diff [collection|skill] [-g] [--raw]
                                          The upstream changes an update would bring
  scilla list [-g]                        Installed Collections and skills
  scilla audit [-g]                       Security ratings of the installed skills

Curator:
  scilla init [--name n] [--description d]
                                          Write scilla.json in the current directory
  scilla ref add <source> [--optional] [--include glob] [--exclude glob] [--no-verify]
                                          Append a Reference to the Collection
  scilla skill new <name>                 Scaffold skills/<name>/SKILL.md
  scilla check [dir]                      Traverse a local Collection and print its tree
  scilla outdated, scilla diff            In a Collection: References against their reviews
  scilla review accept [reference]        Record upstream commits as reviewed
  scilla review propose [--open] [--provider p] [--title-file f] [--body-file f]
                                          Commit the bumps on scilla/review-updates for a PR

Docs:
  scilla docs [topic] [--raw]             Read the manual: start, concepts, sources, manifest,
                                          commands, install, review, audit, agents, all, schema

Options:
  -g, --global        Use the home directory instead of the project
  -y, --yes           Don't open the picker; install the recommended skills
      --all           Tick every skill, optional ones included
      --force         Overwrite skills with local edits
      --no-audit      add, update, diff, review propose: don't fetch security ratings
      --frozen        install: fail when the installed skills differ from the lock
      --check         install: install nothing, only report differences from the lock
      --no-verify     ref add: don't check that a git source is reachable
      --open          review propose: push the branch and open (or update) the PR
      --provider p    review propose: github, gitea, forgejo or gitlab (default: guessed)
      --title-file f, --body-file f
                      review propose: write the PR title and body to files
      --raw           docs, diff: print plain text, even on a terminal
  -h, --help          Show this help
  -v, --version       Show the version

Sources: owner/repo[/path][@name][#ref], a git URL [#ref], or a local directory.

Docs: scilla docs (for people and agents)
`;

/** A command line scilla can't read; the error points at the commands topic. */
export class UsageError extends ScillaError {}

const OPTIONS = {
  global: { type: "boolean", short: "g" },
  yes: { type: "boolean", short: "y" },
  all: { type: "boolean" },
  force: { type: "boolean" },
  audit: { type: "boolean" },
  raw: { type: "boolean" },
  name: { type: "string" },
  description: { type: "string" },
  optional: { type: "boolean" },
  include: { type: "string", multiple: true },
  exclude: { type: "string", multiple: true },
  verify: { type: "boolean" },
  frozen: { type: "boolean" },
  check: { type: "boolean" },
  open: { type: "boolean" },
  provider: { type: "string" },
  "title-file": { type: "string" },
  "body-file": { type: "string" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
} as const;

/** Every long flag the parser knows, as typed (`--no-x` for flags that default to on). */
export const LONG_FLAGS = Object.keys(OPTIONS).map((name) =>
  name === "verify" || name === "audit" ? `--no-${name}` : `--${name}`,
);

/** Every command the parser knows, subcommands with their parent. */
export const COMMAND_NAMES = [
  "add",
  "update",
  "delete",
  "remove",
  "install",
  "outdated",
  "diff",
  "list",
  "audit",
  "docs",
  "init",
  "ref add",
  "skill new",
  "check",
  "review accept",
  "review propose",
];

const Globs = z.array(z.string().min(1, "globs can't be empty")).default([]);

const FlagsSchema = z.object({
  global: z.boolean().default(false),
  yes: z.boolean().default(false),
  all: z.boolean().default(false),
  force: z.boolean().default(false),
  audit: z.boolean().default(true),
  raw: z.boolean().default(false),
  name: z.string().min(1, "--name can't be empty").optional(),
  description: z.string().optional(),
  optional: z.boolean().default(false),
  include: Globs,
  exclude: Globs,
  verify: z.boolean().default(true),
  frozen: z.boolean().default(false),
  check: z.boolean().default(false),
  open: z.boolean().default(false),
  provider: z.enum(PROVIDERS).optional(),
  "title-file": z.string().min(1, "--title-file needs a path").optional(),
  "body-file": z.string().min(1, "--body-file needs a path").optional(),
  help: z.boolean().default(false),
  version: z.boolean().default(false),
});

type Flags = z.infer<typeof FlagsSchema>;

const One = z.tuple([z.string().min(1)]);

const MaybeOne = z.tuple([z.string().min(1).optional()]);

const None = z.tuple([]);

/** Validate a command's positionals, or fail with its usage line. */
const positionals = <T>(schema: z.ZodType<T>, args: readonly string[], usage: string): T => {
  const parsed = schema.safeParse(args);

  if (!parsed.success) {
    throw new UsageError(`usage: scilla ${usage}`);
  }

  return parsed.data;
};

const installFlags = (flags: Flags): InstallFlags => ({
  global: flags.global,
  yes: flags.yes,
  all: flags.all,
  force: flags.force,
  audit: flags.audit,
});

const subcommand = (args: readonly string[], parent: string, child: string, usage: string) => {
  if (args[0] !== child) {
    throw new UsageError(`usage: scilla ${parent} ${usage}`);
  }

  return args.slice(1);
};

const PROPOSE_USAGE =
  "propose [--open] [--provider github|gitea|forgejo|gitlab] [--title-file f] [--body-file f]";

const reviewCommand = (args: readonly string[], flags: Flags): Command => {
  if (args[0] === "propose") {
    positionals(None, args.slice(1), `review ${PROPOSE_USAGE}`);

    return {
      kind: "review-propose",
      open: flags.open,
      provider: flags.provider,
      titleFile: flags["title-file"],
      bodyFile: flags["body-file"],
      audit: flags.audit,
    };
  }

  const [reference] = positionals(
    MaybeOne,
    subcommand(args, "review", "accept", `accept [reference] | review ${PROPOSE_USAGE}`),
    "review accept [reference]",
  );

  return { kind: "review-accept", reference };
};

const curatorCommand = (name: string, args: readonly string[], flags: Flags): Command => {
  switch (name) {
    case "init": {
      positionals(None, args, "init [--name n] [--description d]");

      return { kind: "init", name: flags.name, description: flags.description };
    }

    case "ref": {
      const usage = "add <source> [--optional] [--include glob] [--exclude glob] [--no-verify]";
      const [source] = positionals(One, subcommand(args, "ref", "add", usage), `ref ${usage}`);

      return {
        kind: "ref-add",
        source,
        optional: flags.optional,
        include: flags.include,
        exclude: flags.exclude,
        verify: flags.verify,
      };
    }

    case "skill": {
      const [skill] = positionals(
        One,
        subcommand(args, "skill", "new", "new <name>"),
        "skill new <name>",
      );

      return { kind: "skill-new", name: skill };
    }

    case "check": {
      const [dir] = positionals(MaybeOne, args, "check [dir]");

      return { kind: "check", dir };
    }

    case "review": {
      return reviewCommand(args, flags);
    }

    default: {
      throw new UsageError(`Unknown command "${name}". Run \`scilla --help\` for usage.`);
    }
  }
};

/**
 * `scilla install` only restores the lock. With a source it points at `add` instead of acting
 * like it: an install in CI must never resolve anything new.
 */
const installCommand = (args: readonly string[], flags: Flags): Command => {
  const [source] = args;

  if (source !== undefined) {
    throw new UsageError(
      `scilla install takes no source: it installs what scilla-lock.json records. To add a Collection, run: scilla add ${source}`,
    );
  }

  return {
    kind: "install",
    global: flags.global,
    force: flags.force,
    frozen: flags.frozen,
    check: flags.check,
  };
};

/** The Consumer commands that compare what's installed with the lock or upstream. */
const lockCommand = (name: string, args: readonly string[], flags: Flags): Command => {
  switch (name) {
    case "install": {
      return installCommand(args, flags);
    }

    case "outdated": {
      positionals(None, args, "outdated [-g]");

      return { kind: "outdated", global: flags.global };
    }

    case "diff": {
      const [target] = positionals(MaybeOne, args, "diff [collection|skill] [-g] [--raw]");

      return { kind: "diff", target, global: flags.global, raw: flags.raw, audit: flags.audit };
    }

    default: {
      return curatorCommand(name, args, flags);
    }
  }
};

const consumerCommand = (name: string, args: readonly string[], flags: Flags): Command => {
  switch (name) {
    case "add": {
      const [source] = positionals(One, args, "add <source> [-g] [-y] [--all]");

      return { kind: "add", source, flags: installFlags(flags) };
    }

    case "update": {
      const [collection] = positionals(MaybeOne, args, "update [collection] [-g] [-y] [--force]");

      return { kind: "update", collection, flags: installFlags(flags) };
    }

    case "delete":
    case "remove": {
      const [target] = positionals(One, args, `${name} <collection|skill> [-g] [--force]`);

      return { kind: "delete", target, flags: installFlags(flags) };
    }

    case "list": {
      positionals(None, args, "list [-g]");

      return { kind: "list", global: flags.global };
    }

    case "audit": {
      positionals(None, args, "audit [-g]");

      return { kind: "audit", global: flags.global, enabled: flags.audit };
    }

    case "docs": {
      const [topic] = positionals(MaybeOne, args, "docs [topic] [--raw]");

      return { kind: "docs", topic, raw: flags.raw };
    }

    default: {
      return lockCommand(name, args, flags);
    }
  }
};

const readArgs = (argv: readonly string[]) => {
  try {
    return parseArgs({
      args: [...argv],
      options: OPTIONS,
      allowPositionals: true,
      strict: true,
      allowNegative: true,
    });
  } catch (cause) {
    throw new UsageError(cause instanceof Error ? cause.message : String(cause));
  }
};

/** Parse `process.argv.slice(2)` into a command. */
export const parseCommand = (argv: readonly string[]): Command => {
  const { values, positionals: rest } = readArgs(argv);
  const parsed = FlagsSchema.safeParse(values);

  if (!parsed.success) {
    throw new UsageError(z.prettifyError(parsed.error));
  }

  const flags = parsed.data;

  if (flags.help) {
    return { kind: "help" };
  }

  if (flags.version) {
    return { kind: "version" };
  }

  const [name, ...args] = rest;

  return name === undefined ? { kind: "home" } : consumerCommand(name, args, flags);
};
