// Build step: ship the manifest JSON Schema that `scilla init` points `$schema` at.
import { join } from "node:path";
import { emitSchema } from "../src/schema.ts";

const dir = process.argv[2] ?? join(import.meta.dir, "..", "dist");

process.stdout.write(`Wrote ${await emitSchema(dir)}\n`);
