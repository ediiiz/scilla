import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyPlan, planInstall } from "./consumer.ts";
import { readLock, writeLock, type Lock, type Scope } from "./lock.ts";
import { checkInstalled, restoreLock } from "./restore.ts";
import { parseSource } from "./source.ts";
import { cleanup, fetcher, manifest, Repo, scope, skill, tempDir } from "./testing/fixtures.ts";
import { traverse } from "./traversal.ts";

afterAll(cleanup);

/** Install every recommended skill of `raw` into `target`, as `scilla add -y` would. */
const add = async (target: Scope, raw: string) => {
  const planned = planInstall(
    await traverse(parseSource(raw, "/"), fetcher()),
    await readLock(target),
  );

  const ticked = planned.choices.flatMap((choice) => (choice.selected ? [choice.skill.name] : []));

  await applyPlan(target, await readLock(target), planned, new Set(ticked));

  return readLock(target);
};

/** A teammate's fresh checkout: the same lock file, nothing installed, an empty cache. */
const teammate = async (lock: Lock, options: { readonly global?: boolean } = {}) => {
  const target = scope({ claude: true, global: options.global === true });

  await writeLock(target, lock);

  return target;
};

const skillFile = (target: Scope, name: string) =>
  readFileSync(join(target.base, ".agents", "skills", name, "SKILL.md"), "utf8");

const kit = () =>
  new Repo({
    ...manifest("Kit"),
    ...skill("skills/a", "a", "first version"),
    ...skill("skills/b", "b"),
  });

describe("restoreLock", () => {
  test("installs the locked commits even after upstream moved on", async () => {
    const repo = kit();
    const lock = await add(scope(), repo.url);

    repo.commit(skill("skills/a", "a", "second version"));

    const target = await teammate(lock);
    const restore = await restoreLock(target, lock, fetcher());

    expect(restore).toMatchObject({ installed: ["a", "b"], failed: [], skipped: [] });
    expect(skillFile(target, "a")).toContain("first version");
    expect(await readLock(target)).toEqual(lock);
    expect(await checkInstalled(target, lock)).toEqual({ missing: [], modified: [], extra: [] });
  });

  test("leaves matching folders alone and skips edited ones unless forced", async () => {
    const lock = await add(scope(), kit().url);
    const target = await teammate(lock);

    await restoreLock(target, lock, fetcher());
    writeFileSync(join(target.base, ".agents", "skills", "a", "SKILL.md"), "mine");

    expect(await restoreLock(target, lock, fetcher())).toMatchObject({
      installed: [],
      unchanged: ["b"],
      skipped: [{ name: "a", reason: expect.stringContaining("--force") }],
    });
    expect(await checkInstalled(target, lock)).toMatchObject({ modified: ["a"] });
    expect(await restoreLock(target, lock, fetcher(), { force: true })).toMatchObject({
      updated: ["a"],
    });
    expect(skillFile(target, "a")).toContain("first version");
  });

  test("a commit gone upstream fails that skill only", async () => {
    const gone = new Repo(skill("skills/c", "c"));
    const kept = kit();
    const lock = await add(scope(), kept.url);
    const other = await add(scope(), gone.url);
    const both: Lock = { ...lock, skills: { ...lock.skills, ...other.skills } };

    gone.amend(skill("skills/c", "c", "rewritten"));

    const restore = await restoreLock(await teammate(both), both, fetcher());

    expect(restore.installed).toEqual(["a", "b"]);
    expect(restore.failed).toEqual([
      {
        name: "c",
        reason: expect.stringMatching(/^Commit [0-9a-f]{7} is no longer in file:.*force-pushed/),
      },
    ]);
  });

  test("refuses files that don't match the lock's hash, and anything but a full SHA", async () => {
    const lock = await add(scope(), kit().url);
    const a = lock.skills["a"];
    const b = lock.skills["b"];

    if (a === undefined || b === undefined) {
      throw new Error("expected a and b in the lock");
    }

    const tampered: Lock = {
      ...lock,
      skills: {
        a: { ...a, computedHash: "0".repeat(64) },
        b: { ...b, commit: "--upload-pack=touch /tmp/x" },
      },
    };

    const restore = await restoreLock(await teammate(tampered), tampered, fetcher());

    expect(restore.failed).toEqual([
      { name: "a", reason: expect.stringContaining("don't match the lock's computedHash") },
      { name: "b", reason: '"--upload-pack=touch /tmp/x" is not a full commit SHA.' },
    ]);
  });

  test("a path gone at the locked commit fails, and a local Collection restores from its folder", async () => {
    const folder = tempDir("local-kit");
    const local = new Repo({ ...manifest("Local"), ...skill("skills/l", "l") });
    const lock = await add(scope(), local.dir);
    const l = lock.skills["l"];

    if (l === undefined) {
      throw new Error("expected l in the lock");
    }

    const moved: Lock = {
      ...lock,
      skills: { ...lock.skills, m: { ...l, url: folder, path: "nope" } },
    };

    const restore = await restoreLock(await teammate(moved), moved, fetcher());

    expect(l.commit).toBe("local");
    expect(restore.installed).toEqual(["l"]);
    expect(restore.failed).toEqual([{ name: "m", reason: "nope is missing at local" }]);
  });
});

describe("checkInstalled", () => {
  test("reports missing skills and folders no lock lists, but not the skills CLI's", async () => {
    const lock = await add(scope(), kit().url);
    const target = await teammate(lock);

    mkdirSync(join(target.base, ".agents", "skills", "stray"), { recursive: true });
    mkdirSync(join(target.base, ".agents", "skills", "theirs"), { recursive: true });
    writeFileSync(
      join(target.base, "skills-lock.json"),
      JSON.stringify({ version: 1, skills: { theirs: { source: "x/y" } } }),
    );

    expect(await checkInstalled(target, lock)).toEqual({
      missing: ["a", "b"],
      modified: [],
      extra: ["stray"],
    });
  });

  test("looks for no extra folders in the home directory", async () => {
    const lock = await add(scope({ global: true }), kit().url);
    const target = await teammate(lock, { global: true });

    mkdirSync(join(target.base, ".agents", "skills", "stray"), { recursive: true });

    expect(await checkInstalled(target, lock)).toEqual({
      missing: ["a", "b"],
      modified: [],
      extra: [],
    });
  });
});
