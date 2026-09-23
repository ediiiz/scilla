import { describe, expect, test } from "bun:test";
import {
  diffLines,
  bodyLines,
  collapseTree,
  fileTree,
  frontmatterLines,
  inlineSegments,
  previewHeader,
  previewIntent,
  scrollOffset,
  splitFrontmatter,
} from "./preview-model.ts";
import { choice } from "./test-fixtures.ts";

describe("splitFrontmatter", () => {
  test("reads top-level fields leniently and keeps the body after the fence", () => {
    const doc = splitFrontmatter(
      [
        "\uFEFF---",
        "name: alpha",
        "description: >-",
        "  Folded over",
        "  two lines.",
        "quoted: 'yes'",
        "metadata:",
        "  author: someone",
        "---",
        "# Body",
      ].join("\r\n"),
    );

    expect(doc.fields).toEqual([
      { key: "name", value: "alpha" },
      { key: "description", value: "Folded over two lines." },
      { key: "quoted", value: "yes" },
      { key: "metadata", value: "author: someone" },
    ]);
    expect(doc.body).toBe("# Body");
  });

  test("without a closed fence, everything is body", () => {
    expect(splitFrontmatter("---\nname: x\n# Body")).toEqual({
      fields: [],
      body: "---\nname: x\n# Body",
    });
    expect(splitFrontmatter("Just text.")).toEqual({ fields: [], body: "Just text." });
  });

  test("frontmatter keys are padded to one width", () => {
    expect(
      frontmatterLines([
        { key: "name", value: "a" },
        { key: "license", value: "MIT" },
      ]),
    ).toEqual([
      { key: "name   ", value: "a" },
      { key: "license", value: "MIT" },
    ]);
    expect(frontmatterLines([])).toEqual([]);
  });
});

describe("bodyLines", () => {
  test("classifies headings, lists, quotes, rules and code fences", () => {
    const lines = bodyLines(
      [
        "",
        "## Setup ##",
        "- one",
        "  * nested",
        "2) two",
        "> quoted",
        "---",
        "```sh",
        "# not a heading",
        "\tindented",
        "```",
        "plain   ",
        "",
      ].join("\n"),
    );

    expect(lines.map((line) => [line.kind, line.marker, line.text])).toEqual([
      ["heading", "", "Setup"],
      ["bullet", "• ", "one"],
      ["bullet", "  • ", "nested"],
      ["bullet", "2) ", "two"],
      ["quote", "", "quoted"],
      ["rule", "", ""],
      ["fence", "", "```sh"],
      ["code", "", "# not a heading"],
      ["code", "", "  indented"],
      ["fence", "", "```"],
      ["text", "", "plain"],
    ]);
    expect(lines.map((line) => line.line)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  test("a blank body has no lines", () => {
    expect(bodyLines("\n  \n")).toEqual([]);
  });
});

describe("inlineSegments", () => {
  test("splits out code spans and strong runs", () => {
    expect(inlineSegments("Run `x --y` with **care**, not `")).toEqual([
      { kind: "plain", text: "Run " },
      { kind: "code", text: "x --y" },
      { kind: "plain", text: " with " },
      { kind: "strong", text: "care" },
      { kind: "plain", text: ", not `" },
    ]);
    expect(inlineSegments("")).toEqual([]);
  });
});

describe("fileTree", () => {
  test("sorts by path segment, adds folder rows and marks executables", () => {
    const tree = fileTree(
      ["scripts/run.sh", "SKILL.md", "a/b/c.md", "a/b.md", "a/b/d.md", "scripts/lib/x.py"],
      ["scripts/run.sh", "scripts/lib/x.py"],
    );

    expect(tree.map((entry) => `${"  ".repeat(entry.depth)}${entry.name}`)).toEqual([
      "a/",
      "  b/",
      "    c.md",
      "    d.md",
      "  b.md",
      "scripts/",
      "  lib/",
      "    x.py",
      "  run.sh",
      "SKILL.md",
    ]);
    expect(tree.flatMap((entry) => (entry.executable ? [entry.path] : []))).toEqual([
      "scripts/lib/x.py",
      "scripts/run.sh",
    ]);
    expect(tree.flatMap((entry) => (entry.folder ? [entry.path] : []))).toEqual([
      "a/",
      "a/b/",
      "scripts/",
      "scripts/lib/",
    ]);
  });

  test("the same path twice stays a single folder", () => {
    expect(fileTree(["x/a", "x/a"], []).map((entry) => entry.path)).toEqual(["x/", "x/a", "x/a"]);
  });

  test("long trees collapse with a count, noting hidden executables", () => {
    const files = Array.from({ length: 25 }, (_, index) => `f${String(index).padStart(2, "0")}`);
    const tree = fileTree(files, ["f22", "f24"]);

    expect(collapseTree(tree).shown).toHaveLength(20);
    expect(collapseTree(tree).more).toBe("+5 more (2 can run code)");
    expect(collapseTree(tree, 23).more).toBe("+2 more (1 can run code)");
    expect(collapseTree(tree, 22).more).toBe("+3 more (2 can run code)");
    expect(collapseTree(fileTree(["a", "b", "c"], []), 2).more).toBe("+1 more");
    expect(collapseTree(tree, 25)).toEqual({ shown: tree, more: undefined });
  });
});

describe("scrolling", () => {
  test("moves stay within the content", () => {
    expect(scrollOffset(0, "down", 50, 10)).toBe(1);
    expect(scrollOffset(0, "up", 50, 10)).toBe(0);
    expect(scrollOffset(5, "up", 50, 10)).toBe(4);
    expect(scrollOffset(0, "page-down", 50, 10)).toBe(9);
    expect(scrollOffset(38, "page-down", 50, 10)).toBe(40);
    expect(scrollOffset(20, "page-up", 50, 10)).toBe(11);
    expect(scrollOffset(20, "top", 50, 10)).toBe(0);
    expect(scrollOffset(0, "bottom", 50, 10)).toBe(40);
    expect(scrollOffset(0, "bottom", 5, 10)).toBe(0);
    expect(scrollOffset(0, "page-down", 50, 1)).toBe(1);
  });

  test("keys map to scroll moves or closing", () => {
    expect(previewIntent("j", false)).toEqual({ kind: "scroll", move: "down" });
    expect(previewIntent("up", false)).toEqual({ kind: "scroll", move: "up" });
    expect(previewIntent("pagedown", false)).toEqual({ kind: "scroll", move: "page-down" });
    expect(previewIntent("pageup", false)).toEqual({ kind: "scroll", move: "page-up" });
    expect(previewIntent("g", false)).toEqual({ kind: "scroll", move: "top" });
    expect(previewIntent("g", true)).toEqual({ kind: "scroll", move: "bottom" });
    expect(previewIntent("G", false)).toEqual({ kind: "scroll", move: "bottom" });
    expect(previewIntent("end", false)).toEqual({ kind: "scroll", move: "bottom" });

    for (const name of ["escape", "left", "h", "q"]) {
      expect(previewIntent(name, false)).toEqual({ kind: "close" });
    }

    expect(previewIntent("d", false)).toEqual({ kind: "toggle-diff" });
    expect(previewIntent("x", false)).toBeUndefined();
  });
});

describe("diffLines", () => {
  test("classifies git's headers, hunks, additions, removals and context", () => {
    const patch = [
      "diff --git a/SKILL.md b/SKILL.md",
      "index 1..2 100644",
      "--- a/SKILL.md",
      "+++ b/SKILL.md",
      "@@ -1,2 +1,2 @@",
      " same",
      "-old",
      "+new\tline",
      "Binary files /dev/null and b/x.png differ",
      "",
    ].join("\n");

    expect(diffLines(patch).map((line) => [line.kind, line.text])).toEqual([
      ["meta", "diff --git a/SKILL.md b/SKILL.md"],
      ["meta", "index 1..2 100644"],
      ["meta", "--- a/SKILL.md"],
      ["meta", "+++ b/SKILL.md"],
      ["hunk", "@@ -1,2 +1,2 @@"],
      ["context", " same"],
      ["removed", "-old"],
      ["added", "+new  line"],
      ["meta", "Binary files /dev/null and b/x.png differ"],
    ]);
    expect(diffLines("no newline").map((line) => line.kind)).toEqual(["context"]);
  });
});

describe("previewHeader", () => {
  test("recommended skill with a via chain", () => {
    expect(previewHeader(choice({ name: "a", via: ["x/one", "y/two"] }))).toEqual({
      name: "a",
      marker: "recommended",
      description: "Does a things.",
      origin: [
        "url     https://github.com/acme/skills.git",
        "path    skills/a",
        "commit  0123456",
        "via     x/one › y/two",
      ],
      clash: undefined,
    });
  });

  test("optional conflict without a description or note", () => {
    const header = previewHeader(
      choice({ name: "b", optional: true, status: "conflict", description: "" }),
    );

    expect(header.marker).toBe("optional");
    expect(header.description).toBe("(no description)");
    expect(header.origin).toHaveLength(3);
    expect(header.clash).toBe("a skill with this name is already installed");
  });
});
