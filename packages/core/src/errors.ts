/** An expected failure with a message meant for the Consumer or Curator. */
export class ScillaError extends Error {
  override readonly name = "ScillaError";

  /** Raw output behind the message (such as git's full stderr), shown only when debugging. */
  readonly detail: string | undefined;

  constructor(message: string, detail?: string) {
    super(message);
    this.detail = detail;
  }
}

/** A source string (`owner/repo…`, a git URL, a local path) that doesn't parse. */
export class SourceError extends ScillaError {}

/** A Curator's mistake in a Collection (bad `scilla.json`, a same-name clash); always fatal. */
export class ManifestError extends ScillaError {}

/** The message of a caught error, without the `Name:` prefix `String(error)` adds. */
export const messageOf = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

/** The debug detail a caught error carries, if it is a `ScillaError` with one. */
export const detailOf = (cause: unknown) =>
  cause instanceof ScillaError ? cause.detail : undefined;
