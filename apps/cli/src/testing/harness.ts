import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { AuditFetch, AuditReport, Manifest, Plan } from "@scilla/core";
import type { HomeAction, HomeContext } from "@scilla/tui";
import type { Io, Tui } from "../io.ts";
import { main } from "../main.ts";

// No user or system git config may leak into the fixtures, and nothing is cached under the real home.
const ISOLATED_ENV = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };

Object.assign(process.env, ISOLATED_ENV);

const made: string[] = [];

/** A fresh directory under the system temp dir; `removeTemps` deletes them all. */
export const temp = (label: string) => {
  const dir = mkdtempSync(join(tmpdir(), `scilla-cli-${label}-`));

  made.push(dir);

  return dir;
};

export const removeTemps = () => {
  for (const dir of made.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
};

process.env["SCILLA_CACHE_DIR"] = temp("cache");

/** Relative path to contents; a `!` suffix on the path marks the file executable. */
export type Tree = Readonly<Record<string, string>>;

export const plant = (root: string, tree: Tree) => {
  for (const [entry, text] of Object.entries(tree)) {
    const executable = entry.endsWith("!");
    const path = join(root, executable ? entry.slice(0, -1) : entry);

    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);

    if (executable) {
      chmodSync(path, 0o755);
    }
  }

  return root;
};

/** A skill folder's SKILL.md, keyed by `<folder>/SKILL.md`. */
export const skillAt = (folder: string, name: string) => ({
  [`${folder}/SKILL.md`]: `---\nname: ${name}\ndescription: ${name} does things.\n---\n\n# ${name}\n`,
});

/** A `scilla.json` for a Collection named `name`. */
export const manifestFile = (name: string, rest: Omit<Manifest, "name" | "description"> = {}) => ({
  "scilla.json": `${JSON.stringify({ name, description: `About ${name}.`, ...rest }, null, 2)}\n`,
});

const runGit = (cwd: string, args: readonly string[]) => {
  const child = Bun.spawnSync(
    ["git", "-c", "user.name=T", "-c", "user.email=t@t.invalid", ...args],
    {
      cwd,
    },
  );

  if (!child.success) {
    throw new Error(`git ${args.join(" ")}: ${child.stderr.toString()}`);
  }
};

/** A git repo holding `tree`, committed on `main`; returns its `file://` URL and a way to commit more. */
export const gitFixture = (tree: Tree) => {
  const dir = plant(temp("repo"), tree);

  const commit = (more: Tree, drop: readonly string[] = []) => {
    plant(dir, more);

    for (const path of drop) {
      rmSync(join(dir, path), { recursive: true, force: true });
    }

    runGit(dir, ["add", "--all"]);
    runGit(dir, ["commit", "--quiet", "--allow-empty", "-m", "fixture"]);
  };

  /** Rewrite the last commit with `more`, as a force-push upstream would. */
  const amend = (more: Tree) => {
    plant(dir, more);
    runGit(dir, ["add", "--all"]);
    runGit(dir, ["commit", "--quiet", "--amend", "-m", "fixture (rewritten)"]);
    // Gone for good, so a fetch of the old commit by id fails as it would upstream.
    runGit(dir, ["reflog", "expire", "--expire=now", "--all"]);
    runGit(dir, ["gc", "--quiet", "--prune=now"]);
  };

  runGit(dir, ["init", "--quiet", "--initial-branch=main"]);
  commit({});

  return { dir, url: `file://${dir}`, commit, amend };
};

/**
 * A fetch cache in which GitHub's `owner/repo` is the fixture repo at `dir`: its mirror of the
 * GitHub URL fetches from `dir`, so `scilla add owner/repo` works without the network.
 */
export const githubCache = (repo: string, dir: string) => {
  const cacheDir = temp("github-cache");
  const key = createHash("sha256").update(`https://github.com/${repo}.git`).digest("hex");
  const mirror = join(cacheDir, "repos", key.slice(0, 32));

  mkdirSync(dirname(mirror), { recursive: true });
  runGit(cacheDir, ["clone", "--mirror", "--quiet", `file://${dir}`, mirror]);

  return cacheDir;
};

class Sink {
  text = "";

  readonly isTTY: boolean;

  constructor(isTTY = false) {
    this.isTTY = isTTY;
  }

  write(chunk: string) {
    this.text += chunk;

    return true;
  }
}

export interface Stubs {
  readonly cwd?: string | undefined;
  readonly home?: string | undefined;
  readonly interactive?: boolean | undefined;
  readonly debug?: boolean | undefined;
  readonly pickSkills?: Tui["pickSkills"] | undefined;
  readonly runHome?: Tui["runHome"] | undefined;
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
  /** Answers audit requests; by default every request fails, so no test reaches the network. */
  readonly fetch?: AuditFetch | undefined;
  /** Answers questions (the risky-install confirmation); by default none may be asked. */
  readonly ask?: ((question: string) => Promise<string>) | undefined;
  /** Whether stdout is a terminal (for `scilla docs` styling). */
  readonly tty?: boolean | undefined;
  readonly cacheDir?: string | undefined;
}

const refuse = () => Promise.reject(new Error("the TUI should not open"));

const offline: AuditFetch = (url) => Promise.reject(new Error(`no network in tests: ${url}`));

const silent = (question: string) => Promise.reject(new Error(`unexpected question: ${question}`));

/** Run `main` against stubbed I/O; returns the exit code, the output, and what the TUI was shown. */
export const cli = async (argv: readonly string[], stubs: Stubs = {}) => {
  const stdout = new Sink(stubs.tty);
  const stderr = new Sink();
  const plans: Plan[] = [];
  const audits: (Promise<AuditReport> | undefined)[] = [];
  const contexts: HomeContext[] = [];
  const questions: string[] = [];
  const ask = stubs.ask ?? silent;
  const pickSkills = stubs.pickSkills ?? refuse;
  const runHome = stubs.runHome ?? refuse;

  const io: Io = {
    cwd: stubs.cwd ?? temp("project"),
    home: stubs.home ?? temp("home"),
    stdout,
    stderr,
    interactive: stubs.interactive ?? false,
    debug: stubs.debug ?? false,
    cacheDir: stubs.cacheDir ?? temp("fetch-cache"),
    env: stubs.env ?? {},
    fetch: stubs.fetch ?? offline,
    ask: (question) => {
      questions.push(question);

      return ask(question);
    },
    tui: {
      pickSkills: (plan, options) => {
        plans.push(plan);
        audits.push(options?.audit);

        return pickSkills(plan, options);
      },
      runHome: (context): Promise<HomeAction | undefined> => {
        contexts.push(context);

        return runHome(context);
      },
      withProgress: (_label, task) => task(),
    },
  };

  const code = await main(argv, io);

  return {
    code,
    stdout: stdout.text,
    stderr: stderr.text,
    plans,
    audits,
    contexts,
    questions,
    io,
  };
};
