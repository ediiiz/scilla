import { ScillaError } from "./errors.ts";

/**
 * Run git and collect its output. With a `timeout` (ms), git is killed when it runs longer; the
 * result is then marked `timedOut` without waiting for output that a lingering child (such as an
 * ssh command) may still hold open.
 */
export const runGit = async (args: readonly string[], cwd: string, timeout?: number) => {
  const child = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });

  let timedOut = false;

  const timer =
    timeout === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, timeout);

  const output = Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);

  const code = await child.exited;

  clearTimeout(timer);

  if (timedOut) {
    return { stdout: "", stderr: "", code, timedOut };
  }

  const [stdout, stderr] = await output;

  return { stdout, stderr, code, timedOut: false };
};

/**
 * The most useful line of git's stderr: its first `fatal:` line (the specific one, such as "does
 * not appear to be a git repository", before the generic "Could not read from remote
 * repository."), else its first non-empty line.
 */
const gitSummary = (stderr: string) => {
  const lines = stderr.split("\n").flatMap((line) => (line.trim() === "" ? [] : [line.trim()]));

  return lines.find((line) => line.startsWith("fatal:")) ?? lines[0];
};

export const gitError = (args: readonly string[], stderr: string, code: number) => {
  const detail = stderr.trim();

  return new ScillaError(
    `git ${args[0] ?? ""} failed: ${gitSummary(stderr) ?? `exit ${code}`}`,
    detail === "" ? undefined : detail,
  );
};

export const git = async (args: readonly string[], cwd = process.cwd()) => {
  const { stdout, stderr, code } = await runGit(args, cwd);

  if (code !== 0) {
    throw gitError(args, stderr, code);
  }

  return stdout.trim();
};
