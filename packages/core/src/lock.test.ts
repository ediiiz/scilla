import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ScillaError } from "./errors.ts";
import {
  fromLockSource,
  readLock,
  syncSkillsLock,
  toLockSource,
  writeLock,
  type Lock,
  type SkillEntry,
} from "./lock.ts";
import { parseSource } from "./source.ts";
import { cleanup, scope } from "./testing/fixtures.ts";

afterAll(cleanup);

const entry = (overrides: Partial<SkillEntry>): SkillEntry => ({
  collections: ["c"],
  kind: "github",
  url: "https://github.com/owner/repo.git",
  path: "skills/x",
  commit: "abc",
  computedHash: "hash",
  optional: false,
  ...overrides,
});

const lockWith = (skills: Lock["skills"]): Lock => ({ version: 1, collections: {}, skills });

describe("readLock and writeLock", () => {
  test("reads an absent lock as empty and round-trips with sorted keys", async () => {
    const target = scope();

    expect(await readLock(target)).toEqual({ version: 1, collections: {}, skills: {} });

    await writeLock(target, lockWith({ zeta: entry({}), alpha: entry({}) }));

    expect(Object.keys((await readLock(target)).skills)).toEqual(["alpha", "zeta"]);
    expect(readFileSync(join(target.base, "scilla-lock.json"), "utf8")).toEndWith("}\n");
  });

  test.each([
    ["not JSON", "{", /not valid JSON: JSON Parse error/],
    [
      "the wrong version",
      JSON.stringify({ version: 2, collections: {}, skills: {} }),
      /is invalid/,
    ],
  ])("rejects a lock that is %s", async (_, text, message) => {
    const target = scope();

    writeFileSync(join(target.base, "scilla-lock.json"), text);

    await expect(readLock(target)).rejects.toThrow(ScillaError);
    await expect(readLock(target)).rejects.toThrow(message);
  });
});

const collection = (source: Lock["collections"][string]["source"]) => ({
  name: "Kit",
  source,
  commit: "abc",
  selected: ["x"],
  declined: [],
});

const OLD_KEY = "https://github.com/owner/repo.git";

describe("locks written before GitHub URLs counted as GitHub", () => {
  test("re-keys github.com https Collections and makes their skills github", async () => {
    const target = scope();
    const ssh = "git@github.com:owner/repo.git";
    const pinned = `${OLD_KEY}//sub#v1`;

    const old: Lock = {
      version: 1,
      collections: {
        [pinned]: collection({ kind: "git", url: OLD_KEY, path: "sub", ref: "v1" }),
        [ssh]: collection({ kind: "git", url: ssh, path: "" }),
      },
      skills: {
        x: entry({ kind: "git", collections: [pinned, ssh] }),
        y: entry({ kind: "git", url: ssh, collections: [ssh] }),
      },
    };

    await writeLock(target, old);

    const lock = await readLock(target);

    expect(Object.keys(lock.collections).toSorted()).toEqual([ssh, "owner/repo/sub#v1"]);
    expect(lock.collections["owner/repo/sub#v1"]?.source.kind).toBe("github");
    expect(lock.collections[ssh]?.source.kind).toBe("git");
    expect(lock.skills["x"]).toMatchObject({
      kind: "github",
      collections: ["owner/repo/sub#v1", ssh],
    });
    expect(lock.skills["y"]).toMatchObject({ kind: "git", collections: [ssh] });
  });

  test("leaves an old key alone when its new key is already taken", async () => {
    const target = scope();

    const old: Lock = {
      version: 1,
      collections: {
        [OLD_KEY]: collection({ kind: "git", url: OLD_KEY, path: "" }),
        "owner/repo": collection({ kind: "github", url: OLD_KEY, path: "" }),
      },
      skills: { x: entry({ kind: "git", collections: [OLD_KEY, "owner/repo"] }) },
    };

    await writeLock(target, old);

    const lock = await readLock(target);

    expect(Object.keys(lock.collections).toSorted()).toEqual([OLD_KEY, "owner/repo"]);
    expect(lock.skills["x"]).toMatchObject({
      kind: "github",
      collections: [OLD_KEY, "owner/repo"],
    });
  });
});

describe("lock sources", () => {
  test("round-trip through the lock", () => {
    const source = parseSource("owner/repo/skills@x#v1", "/");

    expect(fromLockSource(toLockSource(source))).toEqual(source);
  });
});

describe("syncSkillsLock", () => {
  test("writes skills CLI entries for GitHub, local and git sources", async () => {
    const target = scope();

    mkdirSync(join(target.base, "vendor"));

    const lock = lockWith({
      gh: entry({}),
      root: entry({ path: "" }),
      loc: entry({ kind: "local", url: join(target.base, "vendor"), path: "l" }),
      git: entry({ kind: "git", url: "https://example.com/r.git" }),
    });

    expect(await syncSkillsLock(target, lock, [])).toEqual([]);
    expect(JSON.parse(readFileSync(join(target.base, "skills-lock.json"), "utf8"))).toEqual({
      version: 1,
      skills: {
        git: {
          source: "https://example.com/r.git",
          sourceUrl: "https://example.com/r.git",
          sourceType: "git",
          skillPath: "skills/x/SKILL.md",
          computedHash: "hash",
        },
        gh: {
          source: "owner/repo",
          sourceType: "github",
          skillPath: "skills/x/SKILL.md",
          computedHash: "hash",
        },
        loc: {
          source: "./vendor",
          sourceType: "local",
          skillPath: "l/SKILL.md",
          computedHash: "hash",
        },
        root: {
          source: "owner/repo",
          sourceType: "github",
          skillPath: "SKILL.md",
          computedHash: "hash",
        },
      },
    });
  });

  test("keeps unknown fields, drops removed names and skips global scope", async () => {
    const target = scope();
    const file = join(target.base, "skills-lock.json");

    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        skills: { gh: { source: "x", extra: 1 }, old: { source: "y" } },
      }),
    );
    await syncSkillsLock(target, lockWith({ gh: entry({}) }), ["old"]);

    expect(JSON.parse(readFileSync(file, "utf8")).skills).toEqual({
      gh: {
        source: "owner/repo",
        sourceType: "github",
        skillPath: "skills/x/SKILL.md",
        computedHash: "hash",
        extra: 1,
      },
    });

    const global = scope({ global: true });

    expect(await syncSkillsLock(global, lockWith({ gh: entry({}) }), [])).toEqual([]);
  });
});
