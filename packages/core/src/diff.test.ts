import { afterAll, describe, expect, test } from "bun:test";
import { diffSkill, riskyFiles } from "./diff.ts";
import { cleanup, tempDir, writeFiles, type Files } from "./testing/fixtures.ts";

afterAll(cleanup);

const folder = (files: Files) => {
  const dir = tempDir("skill");

  writeFiles(dir, files);

  return dir;
};

describe("diffSkill", () => {
  test("lists added, removed and modified files, binaries and executables", async () => {
    const before = folder({
      "SKILL.md": "# one\nold line\n",
      "gone.txt": "bye\n",
      "tool.sh": "echo same\n",
      "node_modules/x.js": "ignored",
    });

    const after = folder({
      "SKILL.md": "# one\nnew line\n",
      "logo.png": "\u0000\u0001binary",
      "scripts/run.py": "print(1)\n",
      "tool.sh": "echo same\n",
      "was-plain*": "#!/bin/sh\n",
    });

    const diff = await diffSkill(before, after);

    expect(diff.files).toEqual([
      { path: "SKILL.md", change: "modified", binary: false, executable: false },
      { path: "gone.txt", change: "removed", binary: false, executable: false },
      { path: "logo.png", change: "added", binary: true, executable: false },
      { path: "scripts/run.py", change: "added", binary: false, executable: true },
      { path: "was-plain", change: "added", binary: false, executable: true },
    ]);
    expect(riskyFiles(diff).map((file) => file.path)).toEqual(["scripts/run.py", "was-plain"]);
    expect(diff.patch).toContain("diff --git a/SKILL.md b/SKILL.md\n");
    expect(diff.patch).toContain("-old line\n+new line\n");
    expect(diff.patch).toContain("Binary files /dev/null and b/logo.png differ");
    expect(diff.patch).not.toContain("node_modules");
  });

  test("a file that only became executable counts as modified", async () => {
    const before = folder({ "SKILL.md": "x", run: "#!/bin/sh\n" });
    const after = folder({ "SKILL.md": "x", "run*": "#!/bin/sh\n" });

    // A shebang already made it executable, so only the mode differs, and nothing flips.
    expect((await diffSkill(before, after)).files).toEqual([]);

    const plain = folder({ "SKILL.md": "x", data: "plain\n" });
    const flagged = folder({ "SKILL.md": "x", "data*": "plain\n" });

    expect((await diffSkill(plain, flagged)).files).toEqual([
      { path: "data", change: "modified", binary: false, executable: true },
    ]);
  });

  test("a new skill is all added, a gone one all removed, and equal folders have no diff", async () => {
    const skill = folder({ "SKILL.md": "# s\n" });

    expect((await diffSkill(undefined, skill)).files).toEqual([
      { path: "SKILL.md", change: "added", binary: false, executable: false },
    ]);
    expect((await diffSkill(skill, undefined)).patch).toContain("-# s\n");
    expect(await diffSkill(skill, folder({ "SKILL.md": "# s\n" }))).toEqual({
      files: [],
      patch: "",
    });
  });
});
