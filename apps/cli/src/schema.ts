import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { manifestJsonSchema } from "@scilla/core";

/** The manifest JSON Schema's file name, next to the bin in `dist/`. */
export const SCHEMA_FILE = "scilla.schema.json";

/** Where editors fetch the schema from: the published package's `dist/`, via unpkg. */
export const SCHEMA_URL = `https://unpkg.com/scilla-cli/dist/${SCHEMA_FILE}`;

/** Write the manifest JSON Schema into `dir` (the build's `dist/`); returns the file's path. */
export const emitSchema = async (dir: string) => {
  const file = join(dir, SCHEMA_FILE);

  await mkdir(dir, { recursive: true });
  await writeFile(file, `${JSON.stringify(manifestJsonSchema(), null, 2)}\n`);

  return file;
};
