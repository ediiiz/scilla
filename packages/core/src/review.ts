import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { requireManifest } from "./curator.ts";
import { ManifestError, messageOf, ScillaError } from "./errors.ts";
import type { Fetcher } from "./fetch.ts";
import { normalizeReference } from "./manifest.ts";
import { formatSource, type Source } from "./source.ts";

/** The file, next to `scilla.json`, where a Curator records the commit reviewed per Reference. */
export const REVIEW_FILE = "scilla-review.json";

const ReviewSchema = z.object({
  version: z.literal(1),
  references: z.record(
    z.string().min(1),
    z.object({ commit: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/, "a full commit SHA") }),
  ),
});

/** `scilla-review.json`: each Reference (as written in the manifest) to the commit last reviewed. */
export type Review = z.infer<typeof ReviewSchema>;

const parseReview = (text: string, label: string) => {
  try {
    return ReviewSchema.safeParse(JSON.parse(text));
  } catch (cause) {
    throw new ManifestError(`${label} is not valid JSON: ${messageOf(cause)}`);
  }
};

/**
 * Read a Collection's `scilla-review.json`, or undefined when it has none. It's the Curator's file,
 * like the manifest, so a broken one is always fatal. Errors name the file as `label`.
 */
export const readReview = async (
  dir: string,
  label = join(dir, REVIEW_FILE),
): Promise<Review | undefined> => {
  const file = join(dir, REVIEW_FILE);

  if (!existsSync(file)) {
    return undefined;
  }

  const parsed = parseReview(await readFile(file, "utf8"), label);

  if (!parsed.success) {
    throw new ManifestError(`${label} is invalid:\n${z.prettifyError(parsed.error)}`);
  }

  return parsed.data;
};

const writeReview = async (dir: string, review: Review) => {
  const references = Object.fromEntries(
    Object.entries(review.references).toSorted(([a], [b]) => a.localeCompare(b)),
  );

  await writeFile(
    join(dir, REVIEW_FILE),
    `${JSON.stringify({ version: 1, references }, null, 2)}\n`,
  );
};

/** A Reference of the Collection being reviewed, with its reviewed and upstream commits. */
export interface ReferenceStatus {
  /** The Reference as the manifest writes it; its key in `scilla-review.json`. */
  readonly key: string;
  readonly source: Source;
  /** The commit last reviewed; undefined while the Reference floats. */
  readonly reviewed: string | undefined;
  /** The commit its Pin (or the default branch) is at upstream; undefined when it can't be fetched. */
  readonly upstream: string | undefined;
  /** Why the upstream commit is unknown. */
  readonly problem: string | undefined;
}

/**
 * - `reviewed`: upstream is at the reviewed commit
 * - `outdated`: upstream moved past the reviewed commit
 * - `floating`: never reviewed, so Consumers get upstream as it is
 * - `unreachable`: upstream couldn't be fetched
 */
export type ReviewState = "reviewed" | "outdated" | "floating" | "unreachable";

export const reviewState = (status: ReferenceStatus): ReviewState => {
  if (status.upstream === undefined) {
    return "unreachable";
  }

  if (status.reviewed === undefined) {
    return "floating";
  }

  return status.reviewed === status.upstream ? "reviewed" : "outdated";
};

const upstreamCommit = async (fetcher: Fetcher, source: Source) => {
  try {
    return { upstream: (await fetcher.checkout(source)).commit, problem: undefined };
  } catch (cause) {
    if (cause instanceof ScillaError) {
      return { upstream: undefined, problem: cause.message };
    }

    throw cause;
  }
};

/**
 * Each fetched Reference of the Collection in `dir` against its reviewed commit. Local References
 * are left out: their files are part of the Collection, so they're reviewed with it.
 */
export const referenceStatuses = async (
  dir: string,
  fetcher: Fetcher,
  home?: string,
): Promise<ReferenceStatus[]> => {
  const manifest = await requireManifest(dir);
  const review = await readReview(dir);

  const references = (manifest.references ?? []).flatMap((entry) => {
    const reference = normalizeReference(entry, dir, home);

    return reference.source.kind === "local" ? [] : [reference];
  });

  return Promise.all(
    references.map(async ({ label, source }): Promise<ReferenceStatus> => {
      const { upstream, problem } = await upstreamCommit(fetcher, source);

      return { key: label, source, reviewed: review?.references[label]?.commit, upstream, problem };
    }),
  );
};

/** Find a Reference by its key (as the manifest writes it) or its formatted source. */
export const findReference = (statuses: readonly ReferenceStatus[], query: string) => {
  const found = statuses.find(
    (status) => status.key === query || formatSource(status.source) === query,
  );

  if (found === undefined) {
    const keys = statuses.map((status) => status.key).join(", ");

    throw new ScillaError(
      `No fetched Reference "${query}" in this Collection. References: ${keys === "" ? "none" : keys}.`,
    );
  }

  return found;
};

/** A reviewed commit that `acceptReview` recorded. */
export interface Accepted {
  readonly key: string;
  /** The commit reviewed before; undefined when the Reference floated. */
  readonly from: string | undefined;
  readonly to: string;
}

/**
 * Record the upstream commit of each of `statuses` as reviewed, in the Collection's
 * `scilla-review.json`. Entries for References the manifest no longer has are dropped, and
 * References that couldn't be fetched keep what they had. Returns what moved.
 */
export const acceptReview = async (
  dir: string,
  all: readonly ReferenceStatus[],
  accept: readonly ReferenceStatus[],
): Promise<Accepted[]> => {
  const current = (await readReview(dir))?.references ?? {};
  const references: Review["references"] = {};

  for (const status of all) {
    const kept = current[status.key];

    if (kept !== undefined) {
      references[status.key] = kept;
    }
  }

  const accepted = accept.flatMap((status): Accepted[] =>
    status.upstream === undefined || status.upstream === status.reviewed
      ? []
      : [{ key: status.key, from: status.reviewed, to: status.upstream }],
  );

  for (const { key, to } of accepted) {
    references[key] = { commit: to };
  }

  await writeReview(dir, { version: 1, references });

  return accepted;
};
