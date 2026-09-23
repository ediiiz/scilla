import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { ScillaError } from "./errors.ts";
import { formatSource, githubRepo, parseSource, withOverrides } from "./source.ts";

const CWD = "/work/project";

describe("parseSource", () => {
  test("reads GitHub shorthand with a path, a skill and a Pin", () => {
    expect(parseSource("anthropics/skills/skills/pdf@pdf#v1.2", CWD)).toEqual({
      kind: "github",
      url: "https://github.com/anthropics/skills.git",
      path: "skills/pdf",
      ref: "v1.2",
      skill: "pdf",
    });
  });

  test("reads bare owner/repo with nothing else", () => {
    expect(parseSource("  mattpocock/skills  ", CWD)).toEqual({
      kind: "github",
      url: "https://github.com/mattpocock/skills.git",
      path: "",
      ref: undefined,
      skill: undefined,
    });
  });

  test("reads owner/repo@name and trims a trailing slash from the path", () => {
    expect(parseSource("mattpocock/skills@tdd", CWD).skill).toBe("tdd");
    expect(parseSource("owner/repo/skills/#main", CWD)).toMatchObject({
      path: "skills",
      ref: "main",
    });
  });

  test.each([
    [
      "https://git.example.com/team/skills.git#next",
      "https://git.example.com/team/skills.git",
      "next",
    ],
    ["ssh://git@example.com/team/skills", "ssh://git@example.com/team/skills", undefined],
    ["git@github.com:owner/repo.git", "git@github.com:owner/repo.git", undefined],
    ["file:///tmp/repo#v1", "file:///tmp/repo", "v1"],
  ])("reads git URL %s", (raw, url, ref) => {
    expect(parseSource(raw, CWD)).toEqual({ kind: "git", url, path: "", ref, skill: undefined });
  });

  test.each([
    "https://github.com/Owner/Repo",
    "https://github.com/Owner/Repo/",
    "https://github.com/Owner/Repo.git",
    "https://github.com/Owner/Repo.git/",
  ])("reads the GitHub https URL %s as the shorthand", (raw) => {
    const source = parseSource(`${raw}#v1`, CWD);

    expect(source).toEqual({
      kind: "github",
      url: "https://github.com/Owner/Repo.git",
      path: "",
      ref: "v1",
      skill: undefined,
    });
    expect(formatSource(source)).toBe(formatSource(parseSource("Owner/Repo#v1", CWD)));
  });

  test("canonicalises GitHub https URLs", () => {
    expect(parseSource("https://github.com/Owner/Repo", CWD).url).toBe(
      "https://github.com/Owner/Repo.git",
    );
    expect(githubRepo("https://github.com/o/r.git")).toBe("o/r");
    expect(githubRepo("https://example.com/o/r.git")).toBeUndefined();
  });

  test.each([
    ["./skills", "/work/project/skills"],
    ["../other", "/work/other"],
    ["/abs/dir", "/abs/dir"],
    [".", "/work/project"],
    ["..", "/work"],
    ["~/skills", `${homedir()}/skills`],
  ])("reads local path %s", (raw, url) => {
    expect(parseSource(raw, CWD)).toMatchObject({ kind: "local", url, path: "" });
  });

  test("expands ~ to the home it is given", () => {
    expect(parseSource("~", CWD, "/home/other").url).toBe("/home/other");
    expect(parseSource("~/skills@tdd", CWD, "/home/other")).toMatchObject({
      url: "/home/other/skills",
      skill: "tdd",
    });
  });

  test("reads a skill selector on a local path", () => {
    expect(parseSource("./skills@tdd", CWD)).toMatchObject({
      url: "/work/project/skills",
      skill: "tdd",
    });
  });

  test.each(["", "   ", "just-a-word", "owner/repo#"])("rejects %p", (raw) => {
    expect(() => parseSource(raw, CWD)).toThrow(ScillaError);
  });
});

describe("withOverrides", () => {
  test("replaces path and ref only when given", () => {
    const source = parseSource("https://example.com/r.git#main", CWD);

    expect(withOverrides(source, "/skills/", undefined)).toMatchObject({
      path: "skills",
      ref: "main",
    });
    expect(withOverrides(source, undefined, "v2")).toMatchObject({ path: "", ref: "v2" });
  });
});

describe("formatSource", () => {
  test.each([
    "owner/repo",
    "owner/repo/skills/pdf",
    "owner/repo@tdd",
    "owner/repo/a/b@x#v1",
    "o/r#main",
  ])("round-trips GitHub %s", (raw) => {
    expect(formatSource(parseSource(raw, CWD))).toBe(raw);
    expect(parseSource(formatSource(parseSource(raw, CWD)), CWD)).toEqual(parseSource(raw, CWD));
  });

  test("marks a git URL's path with //", () => {
    const source = withOverrides(
      parseSource("https://example.com/r.git#v1", CWD),
      "skills",
      undefined,
    );

    expect(formatSource(source)).toBe("https://example.com/r.git//skills#v1");
    expect(formatSource(parseSource("./x", CWD))).toBe("/work/project/x");
  });
});
