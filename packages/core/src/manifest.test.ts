import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ManifestError } from "./errors.ts";
import {
  manifestJsonSchema,
  normalizeReference,
  parseReferenceEntry,
  readManifest,
  referenceKey,
  referenceLabel,
  writeManifest,
} from "./manifest.ts";
import { cleanup, tempDir, writeFiles } from "./testing/fixtures.ts";

afterAll(cleanup);

describe("readManifest", () => {
  test("is undefined outside a Collection", async () => {
    expect(await readManifest(tempDir())).toBeUndefined();
  });

  test("reads and writes the example manifest", async () => {
    const dir = tempDir();

    const example = {
      $schema: "https://example.com/scilla.schema.json",
      name: "Svelte skills",
      description: "Everything you need for SvelteKit work",
      exclude: ["*-draft"],
      optional: ["svelte-legacy-*"],
      references: [
        "mattpocock/skills@tdd",
        { source: "sveltejs/ai-tools/skills#next", exclude: ["*-internal"] },
        { source: "https://git.example.com/team/skills.git", path: "skills", optional: true },
      ],
    };

    await writeManifest(dir, example);

    expect(await readManifest(dir)).toEqual(example);
    expect(readFileSync(join(dir, "scilla.json"), "utf8")).toEndWith("}\n");
  });

  test("reads a hand-written manifest without $schema", async () => {
    const dir = tempDir();

    writeFiles(dir, { "scilla.json": '{ "name": "kit", "description": "A kit." }\n' });

    expect(await readManifest(dir)).toEqual({ name: "kit", description: "A kit." });
  });

  test.each([
    ["missing description", { name: "x" }],
    ["a bad homepage", { name: "x", description: "y", homepage: "not a url" }],
    ["a bad Reference", { name: "x", description: "y", references: [{ path: "p" }] }],
  ])("rejects %s", async (_, value) => {
    const dir = tempDir();

    writeFiles(dir, { "scilla.json": JSON.stringify(value) });

    await expect(readManifest(dir)).rejects.toThrow(ManifestError);
  });

  test("refuses to write an invalid manifest", async () => {
    await expect(writeManifest(tempDir(), { name: "", description: "d" })).rejects.toThrow(
      ManifestError,
    );
  });
});

describe("References", () => {
  test("normalise the string and object forms", () => {
    expect(normalizeReference("owner/repo/skills#v1", "/")).toMatchObject({
      label: "owner/repo/skills#v1",
      source: { kind: "github", path: "skills", ref: "v1" },
      include: [],
      exclude: [],
      optional: false,
    });
    expect(
      normalizeReference(
        {
          source: "https://x.com/r.git",
          path: "/s/",
          ref: "main",
          include: ["a*"],
          optional: true,
        },
        "/",
      ),
    ).toMatchObject({
      label: "https://x.com/r.git (/s/)",
      source: { path: "s", ref: "main" },
      include: ["a*"],
      optional: true,
    });
  });

  test("have one key for the string form and a bare object", () => {
    expect(referenceKey("o/r")).toBe(referenceKey({ source: "o/r" }));
    expect(referenceKey("o/r")).not.toBe(referenceKey({ source: "o/r", optional: true }));
    expect(referenceLabel({ source: "o/r", path: "p" })).toBe("o/r (p)");
  });

  test("are validated", () => {
    expect(parseReferenceEntry({ source: "o/r", optional: true })).toEqual({
      source: "o/r",
      optional: true,
    });
    expect(() => parseReferenceEntry("")).toThrow(ManifestError);
  });
});

test("manifestJsonSchema describes the manifest, $schema included", () => {
  expect(manifestJsonSchema()).toMatchObject({
    type: "object",
    required: ["name", "description"],
    properties: { $schema: { type: "string" } },
  });
});
