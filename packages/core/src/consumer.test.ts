import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyPlan,
  type ApplyOptions,
  deleteCollection,
  deleteSkill,
  findCollection,
  markChanged,
  planInstall,
  type Plan,
} from "./consumer.ts";
import { ScillaError } from "./errors.ts";
import { readLock, type CollectionEntry, type Lock, type Scope } from "./lock.ts";
import { parseSource } from "./source.ts";
import {
  cleanup,
  fetcher,
  manifest,
  Repo,
  scope,
  skill,
  tempDir,
  writeFiles,
} from "./testing/fixtures.ts";
import { traverse } from "./traversal.ts";

afterAll(cleanup);

const statuses = (plan: Plan) =>
  plan.choices.map((choice) => [choice.skill.name, choice.status, choice.selected]);

const plan = async (target: Scope, raw: string, all = false) =>
  planInstall(await traverse(parseSource(raw, "/"), fetcher()), await readLock(target), all);

/** Plan and apply, ticking what the picker pre-ticks unless `pick` says otherwise. */
const install = async (
  target: Scope,
  raw: string,
  pick?: readonly string[],
  options?: ApplyOptions,
) => {
  const planned = await plan(target, raw);

  const ticked =
    pick ?? planned.choices.flatMap((choice) => (choice.selected ? [choice.skill.name] : []));

  return applyPlan(target, await readLock(target), planned, new Set(ticked), options);
};

const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8"));

const installed = (target: Scope, name: string, file = "SKILL.md") =>
  join(target.base, ".agents", "skills", name, file);

/** A Collection repo with Own Skills a (recommended) and b (optional). */
const kit = () =>
  new Repo({
    ...skill("skills/a", "a"),
    ...skill("skills/b", "b"),
    ...manifest("Kit", { optional: ["b"] }),
  });

describe("markChanged", () => {
  test("marks installed skills whose upstream files differ from the lock", async () => {
    const repo = kit();
    const target = scope();

    await install(target, repo.url);
    repo.commit(skill("skills/a", "a", "changed upstream"));

    const marked = await markChanged(await plan(target, repo.url), await readLock(target));

    expect(marked.choices.map((choice) => [choice.skill.name, choice.changed])).toEqual([
      ["a", true],
      ["b", undefined],
    ]);

    const again = await markChanged(
      await plan(target, `${repo.url}#HEAD~1`),
      await readLock(target),
    );

    expect(again.choices.every((choice) => choice.changed !== true)).toBe(true);
  });
});

describe("planInstall", () => {
  test("pre-ticks recommended skills and leaves optional ones for a new Collection", async () => {
    const repo = kit();
    const target = scope();

    expect(statuses(await plan(target, repo.url))).toEqual([
      ["a", "available", true],
      ["b", "available", false],
    ]);
    expect(statuses(await plan(target, repo.url, true))).toEqual([
      ["a", "available", true],
      ["b", "available", true],
    ]);
  });

  test("shows installed, declined and new skills after an install", async () => {
    const repo = kit();
    const target = scope();

    await install(target, repo.url);
    repo.commit(skill("skills/c", "c"));

    const planned = await plan(target, repo.url);

    expect(planned.key).toBe(repo.url);
    expect(statuses(planned)).toEqual([
      ["a", "installed", true],
      ["b", "declined", false],
      ["c", "new", false],
    ]);
  });

  test("flags a clash with a skill installed from another origin", async () => {
    const target = scope();
    const other = new Repo(skill("a", "a"));

    await install(target, other.url);

    const planned = await plan(target, kit().url);

    expect(planned.choices[0]).toMatchObject({
      status: "conflict",
      selected: false,
      note: `already installed from ${other.url}`,
    });

    const outcome = await applyPlan(target, await readLock(target), planned, new Set(["a"]));

    expect(outcome.skipped).toEqual([{ name: "a", reason: `already installed from ${other.url}` }]);
  });

  test("counts a skill another Collection installed from the same origin as installed", async () => {
    const repo = kit();
    const target = scope();
    const wrapper = tempDir();

    writeFiles(
      wrapper,
      manifest("Wrapper", { references: [{ source: repo.url, include: ["a"] }] }),
    );
    await install(target, repo.url);

    expect(statuses(await plan(target, wrapper))).toEqual([["a", "installed", true]]);
  });
});

describe("applyPlan", () => {
  test("copies files into .agents/skills and links them from .claude/skills", async () => {
    const repo = new Repo({
      ...skill("s/a", "a"),
      "s/a/scripts/run.sh*": "#!/bin/sh\n",
      "s/a/.git": "gitfile",
    });

    const target = scope({ claude: true });
    const outcome = await install(target, repo.url);

    expect(outcome).toEqual({
      installed: ["a"],
      updated: [],
      unchanged: [],
      removed: [],
      skipped: [],
      warnings: [],
    });
    expect(existsSync(installed(target, "a", "scripts/run.sh"))).toBe(true);
    expect(existsSync(installed(target, "a", ".git"))).toBe(false);

    const link = join(target.base, ".claude", "skills", "a");

    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readlinkSync(link)).toBe(join("..", "..", ".agents", "skills", "a"));
    expect(readFileSync(join(link, "SKILL.md"), "utf8")).toContain("name: a");
  });

  test("makes no link without .claude and never clobbers a real folder there", async () => {
    const plain = scope();

    await install(plain, new Repo(skill("a", "a")).url);

    expect(existsSync(join(plain.base, ".claude"))).toBe(false);

    const target = scope({ claude: true });

    writeFiles(target.base, { ".claude/skills/a/SKILL.md": "mine" });

    const outcome = await install(target, new Repo(skill("a", "a")).url);

    expect(outcome.warnings).toEqual([expect.stringContaining("it is a real folder")]);
    expect(readFileSync(join(target.base, ".claude/skills/a/SKILL.md"), "utf8")).toBe("mine");
  });

  test("skips a folder in .agents/skills that scilla didn't install", async () => {
    const target = scope();

    writeFiles(target.base, { ".agents/skills/a/SKILL.md": "theirs" });

    const outcome = await install(target, new Repo(skill("a", "a")).url);

    expect(outcome.skipped).toEqual([
      { name: "a", reason: expect.stringContaining("scilla didn't install") },
    ]);
    expect(readFileSync(installed(target, "a"), "utf8")).toBe("theirs");
    expect(await readLock(target)).toEqual({ version: 1, collections: {}, skills: {} });
  });

  test("writes scilla-lock.json and upserts skills-lock.json", async () => {
    const repo = new Repo({ ...skill("skills/b", "b"), ...skill("skills/a", "a") });
    const target = scope();

    const unrelated = {
      source: "someone/else",
      sourceType: "github",
      skillPath: "x/SKILL.md",
      computedHash: "h",
    };

    writeFileSync(
      join(target.base, "skills-lock.json"),
      JSON.stringify({ version: 1, skills: { zz: unrelated } }),
    );
    await install(target, repo.url);

    const lock = readJson(join(target.base, "scilla-lock.json"));
    const commit = repo.head();

    expect(lock).toEqual({
      version: 1,
      collections: {
        [repo.url]: {
          name: repo.url,
          source: { kind: "git", url: repo.url, path: "" },
          commit,
          selected: ["a", "b"],
          declined: [],
        },
      },
      skills: {
        a: {
          collections: [repo.url],
          kind: "git",
          url: repo.url,
          path: "skills/a",
          commit,
          computedHash: expect.stringMatching(/^[0-9a-f]{64}$/),
          optional: false,
        },
        b: expect.objectContaining({ path: "skills/b" }),
      },
    });
    expect(Object.keys(lock.skills)).toEqual(["a", "b"]);
    expect(readJson(join(target.base, "skills-lock.json"))).toEqual({
      version: 1,
      skills: {
        a: {
          source: repo.url,
          sourceUrl: repo.url,
          sourceType: "git",
          skillPath: "skills/a/SKILL.md",
          computedHash: lock.skills.a.computedHash,
        },
        b: expect.objectContaining({ skillPath: "skills/b/SKILL.md" }),
        zz: unrelated,
      },
    });
  });

  test("updates after an upstream commit", async () => {
    const repo = new Repo({ ...skill("a", "a"), ...skill("b", "b"), ...skill("same", "same") });
    const target = scope();

    await install(target, repo.url);
    repo.commit({ ...skill("a", "a", "Changed."), ...skill("c", "c") }, ["b"]);

    const planned = await plan(target, repo.url);

    expect(planned.removed).toEqual(["b"]);
    expect(statuses(planned)).toEqual([
      ["a", "installed", true],
      ["c", "new", false],
      ["same", "installed", true],
    ]);

    const outcome = await install(target, repo.url);

    expect(outcome).toMatchObject({
      installed: [],
      updated: ["a"],
      unchanged: ["same"],
      removed: ["b"],
    });
    expect(readFileSync(installed(target, "a"), "utf8")).toContain("Changed.");
    expect(existsSync(installed(target, "b"))).toBe(false);
    expect(existsSync(installed(target, "c"))).toBe(false);

    const lock = await readLock(target);

    expect(lock.collections[repo.url]).toMatchObject({
      commit: repo.head(),
      selected: ["a", "same"],
      declined: ["c"],
    });
    expect(Object.keys(lock.skills)).toEqual(["a", "same"]);
  });

  test("an unattended run leaves new and recommended skills undecided", async () => {
    const repo = new Repo({
      ...skill("skills/a", "a"),
      ...skill("skills/b", "b"),
      ...skill("skills/x", "x"),
      ...manifest("Kit", { optional: ["b"] }),
    });

    const target = scope();

    writeFiles(target.base, skill(".agents/skills/x", "x", "Not scilla's."));
    await install(target, repo.url, undefined, { decide: false });
    repo.commit(skill("skills/c", "c"));
    await install(target, repo.url, undefined, { decide: false });

    // x was skipped (a folder scilla didn't install) and c is new: neither is declined. b is
    // optional, so leaving it out was the unattended run's decision.
    expect((await readLock(target)).collections[repo.url]?.declined).toEqual(["b"]);
    expect(statuses(await plan(target, repo.url))).toEqual([
      ["a", "installed", true],
      ["b", "declined", false],
      ["c", "new", false],
      ["x", "new", false],
    ]);

    // Through the picker, leaving a skill unticked declines it.
    await install(target, repo.url);

    expect((await readLock(target)).collections[repo.url]?.declined).toEqual(["b", "c", "x"]);
  });

  test("releases a skill the Consumer unticks, and forgets a Collection with nothing ticked", async () => {
    const repo = new Repo({ ...skill("a", "a"), ...skill("b", "b") });
    const target = scope();

    await install(target, repo.url);
    expect((await install(target, repo.url, ["a"])).removed).toEqual(["b"]);
    expect((await install(target, repo.url, [])).removed).toEqual(["a"]);
    expect(await readLock(target)).toEqual({ version: 1, collections: {}, skills: {} });
  });

  test("skips local edits unless forced", async () => {
    const repo = new Repo(skill("a", "a"));
    const target = scope();

    await install(target, repo.url);
    writeFileSync(installed(target, "a"), "my edit");
    repo.commit(skill("a", "a", "Upstream change."));

    const outcome = await install(target, repo.url);

    expect(outcome.skipped).toEqual([
      { name: "a", reason: expect.stringContaining("local edits") },
    ]);
    expect(readFileSync(installed(target, "a"), "utf8")).toBe("my edit");
    expect((await install(target, repo.url, undefined, { force: true })).updated).toEqual(["a"]);
    expect(readFileSync(installed(target, "a"), "utf8")).toContain("Upstream change.");
  });

  test("keeps a locally edited skill that is gone upstream", async () => {
    const repo = new Repo({ ...skill("a", "a"), ...skill("b", "b") });
    const target = scope();

    await install(target, repo.url);
    writeFileSync(installed(target, "b"), "my edit");
    repo.commit({}, ["b"]);

    const outcome = await install(target, repo.url);

    expect(outcome.skipped).toEqual([{ name: "b", reason: expect.stringContaining("kept") }]);
    expect((await readLock(target)).collections[repo.url]?.selected).toEqual(["a", "b"]);
  });

  test("leaves an unreadable skills-lock.json alone", async () => {
    const target = scope();

    writeFileSync(join(target.base, "skills-lock.json"), "{ not json");

    const outcome = await install(target, new Repo(skill("a", "a")).url);

    expect(outcome.warnings).toEqual([expect.stringContaining("skills-lock.json")]);
    expect(readFileSync(join(target.base, "skills-lock.json"), "utf8")).toBe("{ not json");
  });

  test("uses ~/.agents/scilla-lock.json and no skills-lock.json for --global", async () => {
    const target = scope({ global: true });

    await install(target, new Repo(skill("a", "a")).url);

    expect(existsSync(join(target.base, ".agents", "scilla-lock.json"))).toBe(true);
    expect(existsSync(join(target.base, "scilla-lock.json"))).toBe(false);
    expect(existsSync(join(target.base, "skills-lock.json"))).toBe(false);
    expect(Object.keys((await readLock(target)).skills)).toEqual(["a"]);
  });
});

/** Two local Collections that both reference `repo`. */
const twoCollections = (repo: Repo) =>
  ["One", "Two"].map((name) => {
    const dir = tempDir();

    writeFiles(dir, manifest(name, { references: [repo.url] }));

    return dir;
  });

describe("deleting", () => {
  test("deleteCollection keeps skills another Collection installed", async () => {
    const repo = new Repo({ ...skill("a", "a"), ...skill("b", "b") });
    const target = scope({ claude: true });
    const [one = "", two = ""] = twoCollections(repo);

    await install(target, one);
    await install(target, two);

    const first = await deleteCollection(target, await readLock(target), one);

    expect(first.removed).toEqual([]);
    expect((await readLock(target)).skills["a"]?.collections).toEqual([two]);

    const second = await deleteCollection(target, await readLock(target), two);

    expect(second.removed).toEqual(["a", "b"]);
    expect(existsSync(join(target.base, ".claude", "skills", "a"))).toBe(false);
    expect(await readLock(target)).toEqual({ version: 1, collections: {}, skills: {} });
    expect(readJson(join(target.base, "skills-lock.json"))).toEqual({ version: 1, skills: {} });
  });

  test("deleteCollection keeps local edits unless forced", async () => {
    const repo = new Repo(skill("a", "a"));
    const target = scope();

    await install(target, repo.url);
    writeFileSync(installed(target, "a"), "edit");

    const kept = await deleteCollection(target, await readLock(target), repo.url);

    expect(kept.skipped).toHaveLength(1);
    expect((await readLock(target)).collections[repo.url]?.selected).toEqual(["a"]);
    expect(
      (await deleteCollection(target, await readLock(target), repo.url, true)).removed,
    ).toEqual(["a"]);
  });

  test("deleteSkill removes it and records it as declined", async () => {
    const repo = new Repo({ ...skill("a", "a"), ...skill("b", "b") });
    const target = scope();

    await install(target, repo.url);

    const outcome = await deleteSkill(target, await readLock(target), "a");

    expect(outcome.removed).toEqual(["a"]);
    expect(existsSync(installed(target, "a"))).toBe(false);
    expect((await readLock(target)).collections[repo.url]).toMatchObject({
      selected: ["b"],
      declined: ["a"],
    });
    expect(statuses(await plan(target, repo.url))).toEqual([
      ["a", "declined", false],
      ["b", "installed", true],
    ]);

    await deleteSkill(target, await readLock(target), "b");

    expect((await readLock(target)).collections[repo.url]).toMatchObject({
      selected: [],
      declined: ["a", "b"],
    });
  });

  test("deleteSkill keeps local edits unless forced", async () => {
    const repo = new Repo(skill("a", "a"));
    const target = scope();

    await install(target, repo.url);
    writeFileSync(installed(target, "a"), "edit");

    expect((await deleteSkill(target, await readLock(target), "a")).skipped).toHaveLength(1);
    expect(existsSync(installed(target, "a"))).toBe(true);
    expect((await deleteSkill(target, await readLock(target), "a", true)).removed).toEqual(["a"]);
  });

  test("refuses unknown Collections and skills", async () => {
    const target = scope();
    const lock = await readLock(target);

    await expect(deleteCollection(target, lock, "nope")).rejects.toThrow(ScillaError);
    await expect(deleteSkill(target, lock, "nope")).rejects.toThrow(ScillaError);
  });

  test("findCollection matches a source key or a name", async () => {
    const target = scope();
    const repo = kit();

    await install(target, repo.url);

    const lock = await readLock(target);

    expect(findCollection(lock, repo.url)).toBe(repo.url);
    expect(findCollection(lock, "kIT")).toBe(repo.url);
    expect(findCollection(lock, "missing")).toBeUndefined();
  });

  test("findCollection finds a GitHub Collection by its https URL", () => {
    const entry: CollectionEntry = {
      name: "Kit",
      source: { kind: "github", url: "https://github.com/o/r.git", path: "" },
      commit: "abc",
      selected: [],
      declined: [],
    };

    const lock: Lock = { version: 1, collections: { "o/r": entry }, skills: {} };

    expect(findCollection(lock, "https://github.com/o/r")).toBe("o/r");
    expect(findCollection(lock, "https://github.com/o/r.git")).toBe("o/r");
  });
});
