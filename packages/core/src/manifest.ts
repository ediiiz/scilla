import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { ManifestError, messageOf } from "./errors.ts";
import { parseSource, withOverrides, type Source } from "./source.ts";

export const MANIFEST_FILE = "scilla.json";

const Globs = z.array(z.string().min(1));

const ReferenceObjectSchema = z.object({
  source: z.string().min(1),
  path: z.string().optional(),
  ref: z.string().min(1).optional(),
  include: Globs.optional(),
  exclude: Globs.optional(),
  optional: z.boolean().optional(),
});

const ReferenceEntrySchema = z.union([z.string().min(1), ReferenceObjectSchema]);

const ManifestSchema = z.object({
  $schema: z.string().optional(),
  name: z.string().min(1),
  description: z.string().min(1),
  homepage: z.url().optional(),
  exclude: Globs.optional(),
  optional: Globs.optional(),
  references: z.array(ReferenceEntrySchema).optional(),
});

export type Manifest = z.infer<typeof ManifestSchema>;

export type ReferenceEntry = z.infer<typeof ReferenceEntrySchema>;

/** A Reference with its source parsed and its options defaulted. */
export interface Reference {
  /** The entry as the Curator wrote it, for display. */
  readonly label: string;
  readonly source: Source;
  readonly include: readonly string[];
  readonly exclude: readonly string[];
  readonly optional: boolean;
}

// The string form is shorthand for an object with only `source`.
const ReferenceInputSchema = z.union([
  z.string().transform((source) => ReferenceObjectSchema.parse({ source })),
  ReferenceObjectSchema,
]);

/** Validate a Reference entry (from a CLI or TUI) against the manifest schema. */
export const parseReferenceEntry = (raw: ReferenceEntry) => {
  const parsed = ReferenceEntrySchema.safeParse(raw);

  if (!parsed.success) {
    throw new ManifestError(`Invalid Reference:\n${z.prettifyError(parsed.error)}`);
  }

  return parsed.data;
};

/** A stable key for a Reference entry: the string form and `{ source }` alone are the same entry. */
export const referenceKey = (raw: ReferenceEntry) =>
  JSON.stringify(ReferenceInputSchema.parse(raw));

/** The entry as the Curator wrote it, for display and warnings. */
export const referenceLabel = (raw: ReferenceEntry) => {
  const entry = ReferenceInputSchema.parse(raw);

  return entry.path === undefined ? entry.source : `${entry.source} (${entry.path})`;
};

/** Parse a Reference entry; relative local sources resolve against `cwd`, `~` against `home`. */
export const normalizeReference = (raw: ReferenceEntry, cwd: string, home?: string): Reference => {
  const entry = ReferenceInputSchema.parse(raw);

  return {
    label: referenceLabel(entry),
    source: withOverrides(parseSource(entry.source, cwd, home), entry.path, entry.ref),
    include: entry.include ?? [],
    exclude: entry.exclude ?? [],
    optional: entry.optional ?? false,
  };
};

const parseJson = (text: string, file: string) => {
  try {
    return ManifestSchema.safeParse(JSON.parse(text));
  } catch (cause) {
    throw new ManifestError(`${file} is not valid JSON: ${messageOf(cause)}`);
  }
};

/**
 * Read `scilla.json` from `dir`, or undefined when `dir` is not a Collection. Errors name the file
 * as `label`, which defaults to its path.
 */
export const readManifest = async (
  dir: string,
  label = join(dir, MANIFEST_FILE),
): Promise<Manifest | undefined> => {
  const file = join(dir, MANIFEST_FILE);

  if (!existsSync(file)) {
    return undefined;
  }

  const parsed = parseJson(await readFile(file, "utf8"), label);

  if (!parsed.success) {
    throw new ManifestError(`${label} is invalid:\n${z.prettifyError(parsed.error)}`);
  }

  return parsed.data;
};

const validated = (manifest: Manifest, file: string) => {
  const parsed = ManifestSchema.safeParse(manifest);

  if (!parsed.success) {
    throw new ManifestError(`${file} would be invalid:\n${z.prettifyError(parsed.error)}`);
  }

  return parsed.data;
};

export const writeManifest = async (dir: string, manifest: Manifest) => {
  const file = join(dir, MANIFEST_FILE);

  await writeFile(file, `${JSON.stringify(validated(manifest, file), null, 2)}\n`);
};

/** JSON Schema for `scilla.json`, for editors (`$schema`). */
export const manifestJsonSchema = () => z.toJSONSchema(ManifestSchema, { io: "input" });
