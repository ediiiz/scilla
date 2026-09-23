import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyPlan, planInstall } from "./consumer.ts";
import { readLock, type Scope } from "./lock.ts";
import { parseSource } from "./source.ts";
import { cleanup, fetcher, manifest, Repo, scope, skill } from "./testing/fixtures.ts";
import { traverse } from "./traversal.ts";
import {
  changesSkills,
  compareInstalled,
  compareTraversals,
  lockedSkillDir,
  type SkillUpdate,
} from "./updates.ts";

afterAll(cleanup);

/** Install `ticked` from the Collection at `url`, deciding the rest as declined. */
const install = async (target: Scope, url: string, ticked: readonly string[]) => {
  const planned = planInstall(
    await traverse(parseSource(url, "/"), fetcher()),
    await readLock(target),
  );

  await applyPlan(target, await readLock(target), planned, new Set(ticked));

  return readLock(target);
};

const summary = (updates: readonly SkillUpdate[]) =>
  updates.map((update) => [update.name, update.change]);

describe("compareInstalled", () => {
  test("finds changed, moved, removed and new skills, but not declined ones", async () => {
    const repo = new Repo({
      ...manifest("Kit"),
      ...skill("skills/edit", "edit"),
      ...skill("skills/same", "same"),
      ...skill("skills/gone", "gone"),
      ...skill("skills/no", "no"),
    });

    const target = scope();
    const lock = await install(target, repo.url, ["edit", "same", "gone"]);
    const first = repo.head();

    repo.commit({ ...skill("skills/edit", "edit", "edited"), ...skill("skills/fresh", "fresh") }, [
      "skills/gone",
    ]);

    const traversal = await traverse(parseSource(repo.url, "/"), fetcher());
    const entry = lock.collections[repo.url];

    if (entry === undefined) {
      throw new Error("expected the Collection in the lock");
    }

    const update = await compareInstalled(repo.url, entry, lock, traversal);

    expect(update).toMatchObject({ key: repo.url, name: "Kit", before: first, after: repo.head() });
    expect(summary(update.skills)).toEqual([
      ["edit", "changed"],
      ["fresh", "new"],
      ["gone", "removed"],
      ["same", "moved"],
    ]);
    expect(changesSkills(update.skills)).toBe(true);
    expect(
      changesSkills(update.skills.filter((skillUpdate) => skillUpdate.change === "moved")),
    ).toBe(false);
  });

  test("an unmoved Collection has no updates, and a lock entry without its skill is ignored", async () => {
    const repo = new Repo({ ...manifest("Kit"), ...skill("skills/a", "a") });
    const target = scope();
    const lock = await install(target, repo.url, ["a"]);
    const traversal = await traverse(parseSource(repo.url, "/"), fetcher());
    const entry = lock.collections[repo.url];

    if (entry === undefined) {
      throw new Error("expected the Collection in the lock");
    }

    const selected = ["a", "ghost"];
    const update = await compareInstalled(repo.url, { ...entry, selected }, lock, traversal);

    expect(update.skills).toEqual([]);
  });
});

describe("compareTraversals", () => {
  test("compares two commits of a Collection", async () => {
    const repo = new Repo({
      ...manifest("Kit"),
      ...skill("skills/a", "a"),
      ...skill("skills/b", "b"),
    });

    const first = repo.head();

    repo.commit({ ...skill("skills/a", "a", "changed"), ...skill("skills/c", "c") }, ["skills/b"]);

    const cache = fetcher();
    const before = await traverse(parseSource(`${repo.url}#${first}`, "/"), cache);
    const after = await traverse(parseSource(repo.url, "/"), cache);

    expect(summary(await compareTraversals(before, after))).toEqual([
      ["a", "changed"],
      ["b", "removed"],
      ["c", "new"],
    ]);
    expect(await compareTraversals(after, after)).toEqual([]);
  });
});

describe("lockedSkillDir", () => {
  test("is the installed copy while it matches the lock, else the locked checkout", async () => {
    const repo = new Repo({ ...manifest("Kit"), ...skill("skills/a", "a", "locked") });
    const target = scope();
    const lock = await install(target, repo.url, ["a"]);
    const entry = lock.skills["a"];

    if (entry === undefined) {
      throw new Error("expected a in the lock");
    }

    const installed = join(target.base, ".agents", "skills", "a");

    expect(await lockedSkillDir(target, "a", entry, fetcher())).toBe(installed);

    writeFileSync(join(installed, "SKILL.md"), "edited");

    const dir = await lockedSkillDir(target, "a", entry, fetcher());

    expect(readFileSync(join(dir, "SKILL.md"), "utf8")).toContain("locked");
  });
});
