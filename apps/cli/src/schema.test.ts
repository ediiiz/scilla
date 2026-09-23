import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { manifestJsonSchema } from "@scilla/core";
import { emitSchema, SCHEMA_FILE } from "./schema.ts";
import { removeTemps, temp } from "./testing/harness.ts";

afterAll(removeTemps);

const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8"));

describe("the shipped manifest schema", () => {
  test("emitSchema writes manifestJsonSchema() as JSON", async () => {
    const dir = join(temp("dist"), "dist");
    const file = await emitSchema(dir);

    expect(file).toBe(join(dir, SCHEMA_FILE));
    expect(readJson(file)).toEqual(manifestJsonSchema());
  });

  test("the build step emits the same file", async () => {
    const dir = temp("dist");
    const script = join(import.meta.dir, "..", "scripts", "emit-schema.ts");
    const child = Bun.spawnSync(["bun", script, dir]);

    expect(child.exitCode).toBe(0);
    expect(readJson(join(dir, SCHEMA_FILE))).toEqual(manifestJsonSchema());
  });
});
