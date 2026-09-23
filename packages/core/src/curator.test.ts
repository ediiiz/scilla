import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { addReference, initCollection, newOwnSkill } from "./curator.ts";
import { readSkill } from "./discovery.ts";
import { ManifestError, ScillaError } from "./errors.ts";
import { readManifest } from "./manifest.ts";
import { cleanup, tempDir } from "./testing/fixtures.ts";

afterAll(cleanup);

const initialised = async () => {
  const dir = tempDir();

  await initCollection(dir, { name: "Kit", description: "My kit" });

  return dir;
};

describe("initCollection", () => {
  test("writes scilla.json once", async () => {
    const dir = tempDir();

    expect(await initCollection(join(dir, "new"), { name: "Kit", description: "My kit" })).toBe(
      join(dir, "new", "scilla.json"),
    );
    expect(await readManifest(join(dir, "new"))).toEqual({
      name: "Kit",
      description: "My kit",
      references: [],
    });
    expect(readFileSync(join(dir, "new", "scilla.json"), "utf8")).not.toContain("$schema");
    await expect(
      initCollection(join(dir, "new"), { name: "Again", description: "d" }),
    ).rejects.toThrow(/already exists/);
  });

  test("writes $schema as the first key", async () => {
    const dir = tempDir();
    const $schema = "https://example.com/scilla.schema.json";

    await initCollection(dir, { $schema, name: "Kit", description: "My kit" });

    const text = readFileSync(join(dir, "scilla.json"), "utf8");

    expect(Object.keys(JSON.parse(text))).toEqual(["$schema", "name", "description", "references"]);
    expect(await readManifest(dir)).toMatchObject({ $schema, name: "Kit" });
  });

  test("rejects an empty name", async () => {
    await expect(initCollection(tempDir(), { name: "", description: "d" })).rejects.toThrow(
      ManifestError,
    );
  });
});

describe("addReference", () => {
  test("appends string and object References in order", async () => {
    const dir = await initialised();

    await addReference(dir, "mattpocock/skills@tdd");
    await addReference(dir, {
      source: "https://example.com/r.git",
      path: "skills",
      optional: true,
    });
    mkdirSync(join(dir, "vendor"));
    await addReference(dir, "./vendor");

    expect((await readManifest(dir))?.references).toEqual([
      "mattpocock/skills@tdd",
      { source: "https://example.com/r.git", path: "skills", optional: true },
      "./vendor",
    ]);
  });

  test("stores a GitHub page link as its shorthand, in either form", async () => {
    const dir = await initialised();

    expect(await addReference(dir, "https://github.com/o/r/tree/v1/skills/pdf")).toMatchObject({
      kind: "github",
      path: "skills/pdf",
      ref: "v1",
    });
    await addReference(dir, {
      source: "https://github.com/o/r/blob/main/tools/SKILL.md",
      optional: true,
    });
    await expect(addReference(dir, "o/r/skills/pdf#v1")).rejects.toThrow(
      /already has this Reference/,
    );

    expect((await readManifest(dir))?.references).toEqual([
      "o/r/skills/pdf#v1",
      { source: "o/r/tools", optional: true },
    ]);
  });

  test("refuses an exact duplicate but allows a different Pin", async () => {
    const dir = await initialised();

    await addReference(dir, "o/r");
    await expect(addReference(dir, { source: "o/r" })).rejects.toThrow(
      /already has this Reference/,
    );
    await addReference(dir, "o/r#v1");

    expect((await readManifest(dir))?.references).toHaveLength(2);
  });

  test("returns the parsed source, and refuses a local path that doesn't exist", async () => {
    const dir = await initialised();

    expect(await addReference(dir, "o/r#v1")).toMatchObject({ kind: "github", ref: "v1" });
    await expect(addReference(dir, "./missing")).rejects.toThrow(
      `Local path ${join(dir, "missing")} does not exist.`,
    );
    expect((await readManifest(dir))?.references).toEqual(["o/r#v1"]);
  });

  test("refuses a source that doesn't parse or a folder that isn't a Collection", async () => {
    await expect(addReference(await initialised(), "not a source")).rejects.toThrow(ScillaError);
    await expect(addReference(tempDir(), "o/r")).rejects.toThrow(/not a Collection/);
  });
});

describe("newOwnSkill", () => {
  test("scaffolds skills/<name>/SKILL.md that discovery reads", async () => {
    const dir = tempDir();
    const file = await newOwnSkill(dir, "my-skill-2");

    expect(file).toBe(join(dir, "skills", "my-skill-2", "SKILL.md"));
    expect(readFileSync(file, "utf8")).toStartWith("---\nname: my-skill-2\ndescription: ");
    expect(await readSkill(join(dir, "skills", "my-skill-2"), dir)).toMatchObject({
      name: "my-skill-2",
      path: "skills/my-skill-2",
    });
    await expect(newOwnSkill(dir, "my-skill-2")).rejects.toThrow(/already exists/);
  });

  test.each(["My-Skill", "has space", "trailing-", "-leading", "double--hyphen", "", "dots.no"])(
    "rejects the name %p",
    async (name) => {
      await expect(newOwnSkill(tempDir(), name)).rejects.toThrow(/must be lowercase/);
    },
  );
});
