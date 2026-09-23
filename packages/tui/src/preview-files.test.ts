import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadPreview } from "./preview-files.ts";

let root = "";

const write = async (path: string, text: string) => {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), text);
};

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "scilla-preview-files-"));
  await Promise.all([
    write("skill/SKILL.md", "# Hello\n"),
    write("skill/scripts/run.sh", "#!/bin/sh\n"),
    write("skill/.git/HEAD", "ref\n"),
    write("skill/deep/node_modules/x.js", "\n"),
    write("skill/.hidden/kept.md", "\n"),
    write("bare/notes.md", "\n"),
    mkdir(join(root, "odd/SKILL.md"), { recursive: true }),
  ]);
});

afterAll(() => rm(root, { recursive: true, force: true }));

describe("loadPreview", () => {
  test("reads SKILL.md and lists files, skipping .git and node_modules", async () => {
    const preview = await loadPreview(join(root, "skill"));

    expect(preview.doc).toEqual({ kind: "text", text: "# Hello\n" });
    expect(preview.files?.toSorted()).toEqual([".hidden/kept.md", "SKILL.md", "scripts/run.sh"]);
  });

  test("a folder without SKILL.md is missing, not an error", async () => {
    expect(await loadPreview(join(root, "bare"))).toEqual({
      doc: { kind: "missing" },
      files: ["notes.md"],
    });
  });

  test("a SKILL.md that can't be read says why", async () => {
    const preview = await loadPreview(join(root, "odd"));

    expect(preview.doc.kind).toBe("unreadable");
    expect(preview.files).toEqual([]);
  });

  test("a folder that doesn't exist lists nothing", async () => {
    expect(await loadPreview(join(root, "gone"))).toEqual({
      doc: { kind: "missing" },
      files: undefined,
    });
  });
});
