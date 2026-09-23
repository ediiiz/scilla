import { describe, expect, test } from "bun:test";
import { ScillaError } from "@scilla/core";
import { parseCommand, UsageError } from "./args.ts";

const none = { global: false, yes: false, all: false, force: false, audit: true };

describe("parseCommand", () => {
  test("no arguments opens the home screen", () => {
    expect(parseCommand([])).toEqual({ kind: "home" });
  });

  test("--help and --version win over a command", () => {
    expect(parseCommand(["add", "x", "--help"])).toEqual({ kind: "help" });
    expect(parseCommand(["-h"])).toEqual({ kind: "help" });
    expect(parseCommand(["--version"])).toEqual({ kind: "version" });
    expect(parseCommand(["-v"])).toEqual({ kind: "version" });
  });

  test("add takes a source and the install flags", () => {
    expect(parseCommand(["add", "owner/repo"])).toEqual({
      kind: "add",
      source: "owner/repo",
      flags: none,
    });

    expect(parseCommand(["add", "-g", "-y", "--all", "--force", "./x"])).toEqual({
      kind: "add",
      source: "./x",
      flags: { global: true, yes: true, all: true, force: true, audit: true },
    });
  });

  test("update takes an optional Collection", () => {
    expect(parseCommand(["update"])).toEqual({
      kind: "update",
      collection: undefined,
      flags: none,
    });
    expect(parseCommand(["update", "svelte", "-y"])).toEqual({
      kind: "update",
      collection: "svelte",
      flags: { ...none, yes: true },
    });
  });

  test("delete and its alias remove", () => {
    expect(parseCommand(["delete", "a"])).toEqual({ kind: "delete", target: "a", flags: none });
    expect(parseCommand(["remove", "a", "--force"])).toEqual({
      kind: "delete",
      target: "a",
      flags: { ...none, force: true },
    });
  });

  test("list", () => {
    expect(parseCommand(["list"])).toEqual({ kind: "list", global: false });
    expect(parseCommand(["list", "--global"])).toEqual({ kind: "list", global: true });
  });

  test("--no-audit turns the install-time ratings off", () => {
    expect(parseCommand(["add", "o/r", "--no-audit"])).toEqual({
      kind: "add",
      source: "o/r",
      flags: { ...none, audit: false },
    });
  });

  test("audit and docs", () => {
    expect(parseCommand(["audit"])).toEqual({ kind: "audit", global: false, enabled: true });
    expect(parseCommand(["audit", "-g", "--no-audit"])).toEqual({
      kind: "audit",
      global: true,
      enabled: false,
    });
    expect(parseCommand(["docs"])).toEqual({ kind: "docs", topic: undefined, raw: false });
    expect(parseCommand(["docs", "agents", "--raw"])).toEqual({
      kind: "docs",
      topic: "agents",
      raw: true,
    });
  });

  test("Curator commands", () => {
    expect(parseCommand(["init"])).toEqual({
      kind: "init",
      name: undefined,
      description: undefined,
    });
    expect(parseCommand(["init", "--name", "kit", "--description", "A kit."])).toEqual({
      kind: "init",
      name: "kit",
      description: "A kit.",
    });

    expect(parseCommand(["ref", "add", "o/r"])).toEqual({
      kind: "ref-add",
      source: "o/r",
      optional: false,
      include: [],
      exclude: [],
      verify: true,
    });

    expect(
      parseCommand([
        "ref",
        "add",
        "o/r",
        "--optional",
        "--include",
        "a*",
        "--include",
        "b*",
        "--exclude",
        "c",
        "--no-verify",
      ]),
    ).toEqual({
      kind: "ref-add",
      source: "o/r",
      optional: true,
      include: ["a*", "b*"],
      exclude: ["c"],
      verify: false,
    });

    expect(parseCommand(["skill", "new", "my-skill"])).toEqual({
      kind: "skill-new",
      name: "my-skill",
    });
    expect(parseCommand(["check"])).toEqual({ kind: "check", dir: undefined });
    expect(parseCommand(["check", "../kit"])).toEqual({ kind: "check", dir: "../kit" });
  });

  test("install, outdated and diff", () => {
    expect(parseCommand(["install"])).toEqual({
      kind: "install",
      global: false,
      force: false,
      frozen: false,
      check: false,
    });
    expect(parseCommand(["install", "-g", "--frozen", "--check", "--force"])).toEqual({
      kind: "install",
      global: true,
      force: true,
      frozen: true,
      check: true,
    });
    expect(parseCommand(["outdated", "-g"])).toEqual({ kind: "outdated", global: true });
    expect(parseCommand(["diff", "kit", "--raw", "--no-audit"])).toEqual({
      kind: "diff",
      target: "kit",
      global: false,
      raw: true,
      audit: false,
    });
  });

  test("review accept and review propose", () => {
    expect(parseCommand(["review", "accept"])).toEqual({
      kind: "review-accept",
      reference: undefined,
    });
    expect(parseCommand(["review", "accept", "acme/skills"])).toEqual({
      kind: "review-accept",
      reference: "acme/skills",
    });
    expect(
      parseCommand([
        "review",
        "propose",
        "--open",
        "--provider",
        "forgejo",
        "--title-file",
        "t.txt",
        "--body-file",
        "b.md",
      ]),
    ).toEqual({
      kind: "review-propose",
      open: true,
      provider: "forgejo",
      titleFile: "t.txt",
      bodyFile: "b.md",
      audit: true,
    });
  });

  test.each([
    [["install", "acme/skills"], "To add a Collection, run: scilla add acme/skills"],
    [["outdated", "x"], "usage: scilla outdated [-g]"],
    [["diff", "a", "b"], "usage: scilla diff [collection|skill]"],
    [["review"], "usage: scilla review accept [reference]"],
    [["review", "accept", "a", "b"], "usage: scilla review accept [reference]"],
    [["review", "propose", "x"], "usage: scilla review propose [--open]"],
    [["review", "propose", "--provider", "bitbucket"], "provider"],
    [["review", "propose", "--body-file", ""], "--body-file needs a path"],
    [["add"], "usage: scilla add <source>"],
    [["add", "a", "b"], "usage: scilla add <source>"],
    [["update", "a", "b"], "usage: scilla update"],
    [["delete"], "usage: scilla delete <collection|skill>"],
    [["remove"], "usage: scilla remove <collection|skill>"],
    [["list", "x"], "usage: scilla list"],
    [["init", "x"], "usage: scilla init"],
    [["ref"], "usage: scilla ref add <source>"],
    [["ref", "remove", "x"], "usage: scilla ref add <source>"],
    [["ref", "add"], "usage: scilla ref add <source>"],
    [["skill", "old", "x"], "usage: scilla skill new <name>"],
    [["check", "a", "b"], "usage: scilla check [dir]"],
    [["audit", "x"], "usage: scilla audit [-g]"],
    [["docs", "a", "b"], "usage: scilla docs [topic] [--raw]"],
    [["frobnicate"], 'Unknown command "frobnicate"'],
    [["add", "x", "--bogus"], "--bogus"],
    [["init", "--name"], "--name"],
    [["init", "--name", ""], "--name can't be empty"],
    [["ref", "add", "x", "--include", ""], "globs can't be empty"],
  ])("%j fails with %s", (argv, message) => {
    expect(() => parseCommand(argv)).toThrow(ScillaError);
    expect(() => parseCommand(argv)).toThrow(UsageError);
    expect(() => parseCommand(argv)).toThrow(message);
  });
});
