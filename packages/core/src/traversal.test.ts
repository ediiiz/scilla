import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { ManifestError } from "./errors.ts";
import { Fetcher } from "./fetch.ts";
import type { ReferenceEntry } from "./manifest.ts";
import { parseSource, withOverrides } from "./source.ts";
import {
  cleanup,
  fetcher,
  manifest,
  Repo,
  skill,
  tempDir,
  writeFiles,
  type Files,
} from "./testing/fixtures.ts";
import { traverse, type Traversal } from "./traversal.ts";

afterAll(cleanup);

const run = (raw: string) => traverse(parseSource(raw, "/"), fetcher());

/** Traverse a local root Collection holding `files` plus a manifest with these References. */
const collection = async (references: readonly ReferenceEntry[], files: Files = {}, extra = {}) => {
  const dir = tempDir("root");

  writeFiles(dir, { ...files, ...manifest("Root", { references: [...references], ...extra }) });

  return run(dir);
};

const names = (traversal: Traversal) => traversal.skills.map((found) => found.name);

const plainRepo = () =>
  new Repo({ ...skill("skills/a", "a"), ...skill("skills/b", "b"), ...skill("skills/c", "c") });

describe("traverse targets", () => {
  test("scans a plain repo", async () => {
    const repo = plainRepo();
    const traversal = await run(repo.url);

    expect(traversal).toMatchObject({
      name: repo.url,
      description: "",
      commit: repo.head(),
      warnings: [],
    });
    expect(traversal.skills[0]).toMatchObject({
      name: "a",
      kind: "git",
      url: repo.url,
      path: "skills/a",
      commit: repo.head(),
      optional: false,
      via: [],
    });
    expect(names(traversal)).toEqual(["a", "b", "c"]);
  });

  test("takes a single skill when the path ends at one", async () => {
    const repo = plainRepo();
    const traversal = await collection([{ source: repo.url, path: "skills/b" }]);

    expect(traversal.skills).toMatchObject([
      { name: "b", path: "skills/b", via: [`${repo.url} (skills/b)`] },
    ]);
  });

  test("takes one skill by @name and warns when it is missing", async () => {
    const dir = tempDir();

    writeFiles(dir, { ...skill("x", "x"), ...skill("y", "y") });

    expect(names(await run(`${dir}@y`))).toEqual(["y"]);
    expect((await run(`${dir}@zzz`)).warnings).toEqual([
      expect.stringContaining('No skill named "zzz"'),
    ]);
  });

  test("follows a Nested Collection and labels each skill's route", async () => {
    const leaf = plainRepo();

    const nested = new Repo({
      ...skill("skills/n", "n"),
      ...manifest("Nested", { references: [{ source: leaf.url, include: ["a"] }] }),
    });

    const traversal = await collection([nested.url], skill("own/o", "o"));

    expect(traversal.name).toBe("Root");
    expect(traversal.description).toBe("Root description");
    expect(traversal.skills.map((found) => [found.name, found.via])).toEqual([
      ["o", []],
      ["n", ["Nested"]],
      ["a", ["Nested", leaf.url]],
    ]);
  });

  test("fails on a missing path in the root", async () => {
    const repo = plainRepo();

    await expect(
      traverse(withOverrides(parseSource(repo.url, "/"), "nope", undefined), fetcher()),
    ).rejects.toThrow(/Path "nope" not found/);
  });
});

describe("filters and marks", () => {
  test("applies include, then exclude, then optional", async () => {
    const repo = plainRepo();

    const traversal = await collection([
      { source: repo.url, include: ["a", "b"], exclude: ["b"], optional: true },
    ]);

    expect(traversal.skills).toMatchObject([{ name: "a", optional: true }]);
  });

  test("applies filters to a Nested Collection's whole output", async () => {
    const nested = new Repo({
      ...skill("n1", "n-one"),
      ...skill("n2", "n-two"),
      ...manifest("Nested"),
    });

    expect(names(await collection([{ source: nested.url, exclude: ["*-two"] }]))).toEqual([
      "n-one",
    ]);
  });

  test("honours top-level exclude and optional globs", async () => {
    const repo = plainRepo();

    const traversal = await collection(
      [repo.url],
      { ...skill("own/draft", "x-draft"), ...skill("own/k", "k") },
      {
        exclude: ["*-draft"],
        optional: ["b", "k"],
      },
    );

    expect(traversal.skills.map((found) => [found.name, found.optional])).toEqual([
      ["k", true],
      ["a", false],
      ["b", true],
      ["c", false],
    ]);
  });

  test("marks a skill optional when any level does", async () => {
    const leaf = plainRepo();
    const nested = new Repo(manifest("Nested", { optional: ["a"], references: [leaf.url] }));
    const traversal = await collection([{ source: nested.url, include: ["a", "b"] }]);

    expect(traversal.skills.map((found) => [found.name, found.optional])).toEqual([
      ["a", true],
      ["b", false],
    ]);
  });
});

describe("Pins", () => {
  test("resolves a tag, a branch and floating HEAD", async () => {
    const repo = new Repo(skill("s", "old"));

    repo.tag("v1");

    const tagged = repo.head();
    const branched = repo.branch("next", skill("s", "on-branch"));
    const head = repo.commit(skill("s", "new"));

    expect((await collection([{ source: repo.url, ref: "v1" }])).skills).toMatchObject([
      { name: "old", commit: tagged },
    ]);
    expect((await run(`${repo.url}#next`)).skills).toMatchObject([
      { name: "on-branch", commit: branched },
    ]);
    expect((await run(repo.url)).skills).toMatchObject([{ name: "new", commit: head }]);
  });

  test("treats conflicting Pins of one repo as different skills", async () => {
    const repo = new Repo(skill("s", "s"));

    repo.tag("v1");
    repo.commit({ "s/extra.md": "more" });

    const nested = new Repo(manifest("Nested", { references: [`${repo.url}#v1`] }));
    const traversal = await collection([repo.url, nested.url]);

    expect(traversal.skills).toMatchObject([{ name: "s", commit: repo.head() }]);
    expect(traversal.warnings).toEqual([expect.stringContaining("keeping the first")]);
  });
});

describe("combining", () => {
  test("keeps a diamond once, recommended over optional", async () => {
    const leaf = plainRepo();
    const left = new Repo(manifest("Left", { references: [{ source: leaf.url, optional: true }] }));
    const right = new Repo(manifest("Right", { references: [leaf.url] }));
    const traversal = await collection([left.url, right.url]);

    expect(traversal.warnings).toEqual([]);
    expect(traversal.skills.map((found) => [found.name, found.optional, found.via[0]])).toEqual([
      ["a", false, "Left"],
      ["b", false, "Left"],
      ["c", false, "Left"],
    ]);
  });

  test("skips a cycle with a warning", async () => {
    const a = new Repo({ ...skill("a", "a"), ...manifest("A") });
    const b = new Repo({ ...skill("b", "b"), ...manifest("B", { references: [a.url] }) });

    a.commit(manifest("A", { references: [b.url] }));

    const traversal = await run(a.url);

    expect(names(traversal)).toEqual(["a", "b"]);
    expect(traversal.warnings).toEqual([expect.stringContaining('cycle back to Collection "A"')]);
  });

  test("fails on a same-name clash straight from one manifest", async () => {
    const repo = plainRepo();

    await expect(collection([repo.url], skill("own/a", "a"))).rejects.toThrow(ManifestError);
  });

  test("keeps the first on a clash through a Nested Collection", async () => {
    const nested = new Repo({ ...skill("x", "a"), ...manifest("Nested") });
    const traversal = await collection([nested.url], skill("own/a", "a"));

    expect(traversal.skills).toMatchObject([{ name: "a", path: "own/a", via: [] }]);
    expect(traversal.warnings).toEqual([expect.stringContaining('skill "a" comes from both')]);
  });
});

describe("errors", () => {
  test("turns a bad Reference into a warning", async () => {
    const repo = plainRepo();

    const traversal = await collection([
      `file://${tempDir()}/missing`,
      "not a source",
      `${repo.url}#nope`,
      repo.url,
    ]);

    expect(names(traversal)).toEqual(["a", "b", "c"]);
    expect(traversal.warnings).toHaveLength(3);
    expect(traversal.warnings[1]).toStartWith('Reference "not a source" skipped');
  });

  test("reports a shared Fetcher's warnings only in the Traversal that raised them", async () => {
    const repo = plainRepo();
    const cacheDir = tempDir("cache");

    await new Fetcher(cacheDir).checkout(parseSource(repo.url, "/"));
    rmSync(repo.dir, { recursive: true, force: true });

    const shared = new Fetcher(cacheDir);
    const offline = await traverse(parseSource(repo.url, "/"), shared);
    const local = tempDir();

    writeFiles(local, skill("l", "l"));

    expect(offline.warnings).toEqual([expect.stringContaining("Using cached")]);
    expect((await traverse(parseSource(local, "/"), shared)).warnings).toEqual([]);
  });

  test("fails on an invalid nested scilla.json", async () => {
    const nested = new Repo({ "scilla.json": JSON.stringify({ name: "No description" }) });

    await expect(collection([nested.url])).rejects.toThrow(ManifestError);
    await expect(run(nested.url)).rejects.toThrow(
      `scilla.json of ${nested.url} at ${nested.head().slice(0, 7)} is invalid:`,
    );
  });

  test("fails on a nested scilla.json that isn't JSON", async () => {
    const nested = new Repo({ "scilla.json": "{ nope" });

    await expect(collection([nested.url])).rejects.toThrow(/not valid JSON: JSON Parse error/);
  });

  test("fails when the root can't be fetched", async () => {
    await expect(run(`file://${tempDir()}/missing`)).rejects.toThrow(/Can't fetch/);
  });
});

describe("local References", () => {
  test("resolve against a local Collection's folder", async () => {
    const dir = tempDir();

    writeFiles(dir, {
      ...skill("vendor/v", "v"),
      ...manifest("Local", { references: ["./vendor"] }),
    });

    expect((await run(dir)).skills).toMatchObject([{ name: "v", kind: "local", commit: "local" }]);
  });

  test("expand ~ to the home Traversal is given", async () => {
    const home = tempDir("home");
    const dir = tempDir();

    writeFiles(home, skill("mine/m", "m"));
    writeFiles(dir, manifest("Local", { references: ["~/mine"] }));

    const traversal = await traverse(parseSource(dir, "/"), fetcher(), { home });

    expect(traversal.skills).toMatchObject([{ name: "m", url: `${home}/mine` }]);
  });

  test("stay inside a fetched Collection's repo", async () => {
    const outside = tempDir();

    writeFiles(outside, skill("secret", "secret"));

    const repo = new Repo({
      ...skill("vendor/v", "v"),
      ...manifest("Remote", { references: ["./vendor", outside] }),
    });

    const traversal = await run(repo.url);

    expect(traversal.skills).toMatchObject([
      { name: "v", kind: "git", url: repo.url, path: "vendor/v", commit: repo.head() },
    ]);
    expect(traversal.warnings).toEqual([expect.stringContaining("must stay inside its repo")]);
  });
});
