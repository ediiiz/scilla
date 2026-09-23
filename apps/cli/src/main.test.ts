import { afterAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { HomeAction } from "@scilla/tui";
import packageJson from "../package.json" with { type: "json" };
import { HELP } from "./args.ts";
import { commandFor } from "./home.ts";
import { cli, manifestFile, plant, removeTemps, skillAt, temp } from "./testing/harness.ts";

afterAll(removeTemps);

const boom = () => Promise.reject(new Error("boom"));

const odd = () => Promise.reject("odd");

const choose = (action: HomeAction | undefined) => () => Promise.resolve(action);

describe("main", () => {
  test("--help and --version", async () => {
    expect(await cli(["--help"])).toMatchObject({ code: 0, stdout: HELP });
    expect(await cli(["--version"])).toMatchObject({ code: 0, stdout: `${packageJson.version}\n` });
  });

  test("a bad command line exits 1 with the message", async () => {
    expect(await cli(["nope"])).toMatchObject({
      code: 1,
      stderr:
        'error: Unknown command "nope". Run `scilla --help` for usage.\nsee: scilla docs commands\n',
    });
  });

  test("an unexpected error shows its message, and its stack only with SCILLA_DEBUG", async () => {
    const source = plant(temp("kit"), skillAt("skills/a", "a"));
    const quiet = await cli(["add", source], { interactive: true, pickSkills: boom });
    const loud = await cli(["add", source], { interactive: true, pickSkills: boom, debug: true });

    expect(quiet).toMatchObject({ code: 1, stderr: "error: boom\n" });
    expect(loud.code).toBe(1);
    expect(loud.stderr).toContain("error: boom\nError: boom\n    at ");
  });

  test("a failed fetch is one line, with git's full stderr only under SCILLA_DEBUG", async () => {
    const bad = `file://${temp("empty")}/nope`;
    const quiet = await cli(["add", bad]);
    const loud = await cli(["add", bad], { debug: true });

    expect(quiet.code).toBe(1);
    expect(quiet.stderr).toMatch(/^error: Can't fetch \S+: git clone failed: fatal: [^\n]+\n$/);
    expect(loud.stderr).toStartWith(quiet.stderr);
    expect(loud.stderr.slice(quiet.stderr.length)).toMatch(/^(( {2}.*)?\n){2,}$/);
  });

  test("errors a docs topic explains end with a pointer to it", async () => {
    const badSource = await cli(["add", "not a source"]);
    const cwd = plant(temp("curator"), { "scilla.json": '{ "name": "kit" }' });
    const badManifest = await cli(["check"], { cwd });

    expect(badSource).toMatchObject({ code: 1 });
    expect(badSource.stderr).toStartWith('error: Can\'t read source "not a source".');
    expect(badSource.stderr).toEndWith("\nsee: scilla docs sources\n");
    expect(badManifest.code).toBe(1);
    expect(badManifest.stderr).toContain("scilla.json is invalid");
    expect(badManifest.stderr).toEndWith("\nsee: scilla docs manifest\n");
    expect((await cli(["delete", "ghost"])).stderr).not.toContain("see:");
  });

  test("a thrown non-Error is shown as text", async () => {
    const source = plant(temp("kit"), skillAt("skills/a", "a"));

    expect(
      await cli(["add", source], { interactive: true, pickSkills: odd, debug: true }),
    ).toMatchObject({
      code: 1,
      stderr: "error: odd\n",
    });
  });
});

describe("home", () => {
  test("without a terminal prints help", async () => {
    expect(await cli([])).toMatchObject({ code: 0, stdout: HELP });
  });

  test("gets both locks and the cwd's Collection, and quitting does nothing", async () => {
    const cwd = plant(temp("curator"), manifestFile("kit"));
    const result = await cli([], { cwd, interactive: true, runHome: choose(undefined) });

    expect(result.code).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.contexts).toEqual([
      {
        project: { version: 1, collections: {}, skills: {} },
        global: { version: 1, collections: {}, skills: {} },
        isCollection: true,
        collectionName: "kit",
      },
    ]);
  });

  test("outside a Collection the Curator actions stay off", async () => {
    const result = await cli([], { interactive: true, runHome: choose(undefined) });

    expect(result.contexts[0]?.isCollection).toBe(false);
    expect(result.contexts[0]?.collectionName).toBeUndefined();
  });

  test("runs the chosen action through the command handlers", async () => {
    const cwd = temp("curator");

    const result = await cli([], {
      cwd,
      interactive: true,
      runHome: choose({ kind: "init", name: "kit", description: "" }),
    });

    expect(result.code).toBe(0);
    expect(existsSync(join(cwd, "scilla.json"))).toBe(true);
  });

  test("an add from the home screen opens the picker", async () => {
    const source = plant(temp("kit"), skillAt("skills/a", "a"));

    const result = await cli([], {
      interactive: true,
      runHome: choose({ kind: "add", source }),
      pickSkills: (plan) =>
        Promise.resolve(new Set(plan.choices.map((choice) => choice.skill.name))),
    });

    expect(result.plans).toHaveLength(1);
    expect(result.stdout).toContain("Installed: a");
  });
});

describe("commandFor", () => {
  const off = { global: false, yes: false, all: false, force: false, audit: true };

  test.each<[HomeAction, ReturnType<typeof commandFor>]>([
    [
      { kind: "add", source: "o/r" },
      { kind: "add", source: "o/r", flags: off },
    ],
    [
      { kind: "update", collection: undefined, global: true },
      { kind: "update", collection: undefined, flags: { ...off, global: true } },
    ],
    [
      { kind: "delete", collection: "o/r", global: false },
      { kind: "delete", target: "o/r", flags: off },
    ],
    [
      { kind: "init", name: "kit", description: "d" },
      { kind: "init", name: "kit", description: "d" },
    ],
    [
      { kind: "ref-add", source: "o/r" },
      { kind: "ref-add", source: "o/r", optional: false, include: [], exclude: [], verify: true },
    ],
    [
      { kind: "skill-new", name: "s" },
      { kind: "skill-new", name: "s" },
    ],
    [{ kind: "check" }, { kind: "check", dir: undefined }],
  ])("%j", (action, command) => {
    expect(commandFor(action)).toEqual(command);
  });
});
