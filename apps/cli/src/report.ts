import type { Outcome } from "@scilla/core";
import type { Io } from "./io.ts";

/** Writes plain lines to stdout and each distinct warning once to stderr. */
export class Reporter {
  readonly #io: Io;

  readonly #warned = new Set<string>();

  constructor(io: Io) {
    this.#io = io;
  }

  line(text = "") {
    this.#io.stdout.write(`${text}\n`);
  }

  /** Under `SCILLA_DEBUG`, `detail` (such as git's full stderr) follows the warning, indented. */
  warn(message: string, detail?: string) {
    if (this.#warned.has(message)) {
      return;
    }

    this.#warned.add(message);
    this.#io.stderr.write(`warning: ${message}\n`);

    if (this.#io.debug && detail !== undefined) {
      this.#io.stderr.write(indented(detail));
    }
  }

  warnAll(messages: readonly string[], details: ReadonlyMap<string, string> = new Map()) {
    for (const message of messages) {
      this.warn(message, details.get(message));
    }
  }
}

/** Raw output for debugging, each line indented under the message it explains. */
export const indented = (text: string) =>
  text
    .split("\n")
    .map((line) => (line.trim() === "" ? "\n" : `  ${line}\n`))
    .join("");

/** Where a command looked: the project or the home directory (`--global`). */
export const where = (global: boolean) => (global ? "globally" : "in this project");

/** The first seven characters of a commit, or "local" for a working directory. */
export const shortCommit = (commit: string) => commit.slice(0, 7);

const LISTED: readonly (readonly [
  label: string,
  key: "installed" | "updated" | "unchanged" | "removed",
])[] = [
  ["Installed", "installed"],
  ["Updated", "updated"],
  ["Unchanged", "unchanged"],
  ["Removed", "removed"],
];

/** Print what an install, update or delete did on stdout; skips and other warnings go to stderr. */
export const printOutcome = (reporter: Reporter, outcome: Outcome) => {
  const lines = LISTED.flatMap(([label, key]) =>
    outcome[key].length === 0 ? [] : [`${label}: ${outcome[key].join(", ")}`],
  );

  for (const text of lines.length === 0 ? ["Nothing changed."] : lines) {
    reporter.line(text);
  }

  for (const skip of outcome.skipped) {
    reporter.warn(`Skipped ${skip.name}: ${skip.reason}`);
  }

  reporter.warnAll(outcome.warnings);
};

/** Rows of cells as lines: each column padded to its widest cell, indented by two spaces. */
export const table = (rows: readonly (readonly string[])[]) => {
  const widths = (rows[0] ?? []).map((_, column) =>
    Math.max(...rows.map((row) => row[column]?.length ?? 0)),
  );

  return rows.map((row) =>
    `  ${row.map((text, column) => text.padEnd(widths[column] ?? 0)).join("  ")}`.trimEnd(),
  );
};

/** Style only for a person at a terminal: not with `--raw`, a pipe, or `NO_COLOR`. */
export const wantsStyle = (io: Io, raw: boolean) =>
  !raw && io.stdout.isTTY === true && (io.env["NO_COLOR"] ?? "") === "";

const STYLES = {
  heading: "\u001B[1;36m",
  bold: "\u001B[1m",
  dim: "\u001B[2m",
  added: "\u001B[32m",
  removed: "\u001B[31m",
  warn: "\u001B[33m",
} as const;

export type Style = keyof typeof STYLES;

const RESET = "\u001B[0m";

/** Wrap text in a terminal style, or leave it plain when `styled` is false. */
export const paint = (styled: boolean) => (text: string, style: Style) =>
  styled ? `${STYLES[style]}${text}${RESET}` : text;
