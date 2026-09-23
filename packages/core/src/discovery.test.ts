import { afterAll, describe, expect, test } from "bun:test";
import { discoverSkills, readSkill } from "./discovery.ts";
import { cleanup, skill, skillMd, tempDir, writeFiles } from "./testing/fixtures.ts";

afterAll(cleanup);

const names = async (dir: string) => (await discoverSkills(dir, dir)).map((found) => found.path);

describe("discoverSkills", () => {
  test("stops at the first SKILL.md on each branch and sorts by path", async () => {
    const dir = tempDir();

    writeFiles(dir, {
      ...skill("skills/zeta", "zeta"),
      ...skill("skills/alpha", "alpha"),
      ...skill("skills/alpha/inner", "inner"),
      "skills/notes/README.md": "not a skill",
    });

    expect(await names(dir)).toEqual(["skills/alpha", "skills/zeta"]);
  });

  test("skips installed-copy dot-dirs and node_modules but keeps .curated", async () => {
    const dir = tempDir();

    writeFiles(dir, {
      ...skill(".agents/skills/copy", "copy"),
      ...skill(".claude/skills/copy", "copy"),
      ...skill("node_modules/pkg/skill", "pkg"),
      ...skill(".git/x", "x"),
      ...skill("skills/.curated/kept", "kept"),
      ...skill(".experimental/beta", "beta"),
    });

    expect(await names(dir)).toEqual([".experimental/beta", "skills/.curated/kept"]);
  });

  test("gives up below depth 6", async () => {
    const dir = tempDir();

    writeFiles(dir, { ...skill("1/2/3/4/5/6", "deep"), ...skill("1/2/3/4/5/6/7", "deeper") });
    writeFiles(dir, skill("a/b/c/d/e/f/g", "too-deep"));

    expect(await names(dir)).toEqual(["1/2/3/4/5/6"]);
  });

  test("returns the root itself when it is a skill", async () => {
    const dir = tempDir();

    writeFiles(dir, { "SKILL.md": skillMd("root") });

    expect(await discoverSkills(dir, dir)).toMatchObject([{ name: "root", path: "" }]);
  });
});

describe("readSkill", () => {
  test("reads name and description from frontmatter", async () => {
    const dir = tempDir();

    writeFiles(dir, { "s/SKILL.md": skillMd("real-name", "  Does things.  ") });

    expect(await readSkill(`${dir}/s`, dir)).toMatchObject({
      name: "real-name",
      description: "Does things.",
      path: "s",
      executables: [],
    });
  });

  test.each([
    ["no frontmatter", "# Just a heading\n"],
    ["no name", "---\ndescription: only this\n---\n"],
    ["a non-string name", "---\nname: 42\nmetadata:\n  deep: [1, 2]\n---\n"],
    ["broken YAML", "---\nname: [unclosed\n  : :\n---\n"],
    ["a scalar document", "---\njust text\n---\n"],
    ["a BOM and CRLF with an empty name", "﻿---\r\nname: '  '\r\n---\r\n"],
  ])("falls back to the dir name with %s", async (_, text) => {
    const dir = tempDir();

    writeFiles(dir, { "fallback/SKILL.md": text });

    const found = await readSkill(`${dir}/fallback`, dir);

    expect(found.name).toBe("fallback");
    expect(found.description).toBeString();
  });

  test("keeps odd but valid YAML values", async () => {
    const dir = tempDir();

    writeFiles(dir, {
      "s/SKILL.md":
        "---\nname: odd\ndescription: >\n  Folded\n  text\nallowed-tools: [Read]\n---\n",
    });

    expect(await readSkill(`${dir}/s`, dir)).toMatchObject({
      name: "odd",
      description: "Folded text",
    });
  });

  test("flags executables by exec bit or script extension", async () => {
    const dir = tempDir();

    writeFiles(dir, {
      ...skill("s", "s"),
      "s/scripts/run*": "#!/bin/sh\n",
      "s/scripts/tool.py": "print()\n",
      "s/notes.md": "text",
    });

    expect((await readSkill(`${dir}/s`, dir)).executables).toEqual([
      "s/scripts/run",
      "s/scripts/tool.py",
    ]);
  });
});
