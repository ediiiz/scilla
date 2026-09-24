import { createInterface } from "node:readline/promises";
import type { AuditFetch, Plan, Scope } from "@scilla/core";
import type { HomeAction, HomeContext, PickOptions, PickResult, ProgressStream } from "@scilla/tui";

/** The TUI entry points the CLI calls; tests pass stubs. */
export interface Tui {
  readonly pickSkills: (plan: Plan, options?: PickOptions) => Promise<PickResult | undefined>;
  readonly runHome: (context: HomeContext) => Promise<HomeAction | undefined>;
  readonly withProgress: <T>(
    label: string,
    task: () => Promise<T>,
    stream?: ProgressStream,
  ) => Promise<T>;
}

/** Everything `main` touches outside itself, so tests can run it against temp dirs. */
export interface Io {
  readonly cwd: string;
  readonly home: string;
  readonly stdout: ProgressStream;
  readonly stderr: ProgressStream;
  /** Both stdin and stdout are terminals, so the TUI may open. */
  readonly interactive: boolean;
  /** Show stack traces for unexpected errors (`SCILLA_DEBUG`). */
  readonly debug: boolean;
  /** Fetcher cache root; undefined uses the default (`$SCILLA_CACHE_DIR`, XDG, `~/.cache`). */
  readonly cacheDir: string | undefined;
  /** The environment, for opt-outs (`DO_NOT_TRACK`, `SCILLA_NO_AUDIT`, `NO_COLOR`…). */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Network access for security ratings; tests pass a stub. */
  readonly fetch: AuditFetch;
  /** Ask a question on the terminal and resolve with the line typed in answer. */
  readonly ask: (question: string) => Promise<string>;
  readonly tui: Tui;
}

/** An `ask` that writes the question to `output` and reads one line from `input`. */
export const askLine =
  (input: NodeJS.ReadableStream, output: NodeJS.WritableStream) => async (question: string) => {
    const lines = createInterface({ input, output });

    try {
      return await lines.question(question);
    } finally {
      lines.close();
    }
  };

/** The project scope (cwd), or the home directory for `--global`. */
export const scopeFor = (io: Io, global: boolean): Scope =>
  global ? { base: io.home, global: true } : { base: io.cwd, global: false };
