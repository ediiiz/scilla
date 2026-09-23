import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ManifestError, ScillaError } from "./errors.ts";
import {
  acceptReview,
  findReference,
  readReview,
  REVIEW_FILE,
  referenceStatuses,
  reviewState,
} from "./review.ts";
import { parseSource } from "./source.ts";
import {
  cleanup,
  fetcher,
  manifest,
  Repo,
  skill,
  tempDir,
  writeFiles,
} from "./testing/fixtures.ts";
import { traverse } from "./traversal.ts";

afterAll(cleanup);

const reviewFile = (commits: Readonly<Record<string, string>>) => ({
  [REVIEW_FILE]: JSON.stringify({
    version: 1,
    references: Object.fromEntries(
      Object.entries(commits).map(([key, commit]) => [key, { commit }]),
    ),
  }),
});

/** An upstream repo with skill `up` that has moved on once since `first`. */
const movedUpstream = () => {
  const repo = new Repo(skill("up", "up", "reviewed version"));
  const first = repo.head();

  repo.commit(skill("up", "up", "newer version"));

  return { repo, first };
};

const collection = (files: Readonly<Record<string, string>>) => {
  const dir = tempDir("collection");

  writeFiles(dir, files);

  return dir;
};

const description = (dir: string) => readFileSync(join(dir, "SKILL.md"), "utf8");

describe("readReview", () => {
  test("is undefined without a file and fatal when the file is broken", async () => {
    expect(await readReview(collection({}))).toBeUndefined();
    await expect(readReview(collection({ [REVIEW_FILE]: "{" }))).rejects.toThrow(ManifestError);
    await expect(readReview(collection(reviewFile({ x: "abc1234" })))).rejects.toThrow(
      /a full commit SHA/,
    );
  });
});

describe("Traversal and reviewed commits", () => {
  test("a reviewed Reference resolves to its reviewed commit, unless asked for upstream", async () => {
    const { repo, first } = movedUpstream();

    const dir = collection({
      ...manifest("Kit", { references: [repo.url] }),
      ...reviewFile({ [repo.url]: first }),
    });

    const reviewed = await traverse(parseSource(dir, "/"), fetcher());
    const upstream = await traverse(parseSource(dir, "/"), fetcher(), { reviewed: false });

    expect(reviewed.skills.map((found) => [found.name, found.commit, found.reference])).toEqual([
      ["up", first, repo.url],
    ]);
    expect(description(reviewed.skills[0]?.dir ?? "")).toContain("reviewed version");
    expect(upstream.skills[0]?.commit).toBe(repo.head());
  });

  test("a Nested Collection follows its own review, even when the root asks for upstream", async () => {
    const { repo, first } = movedUpstream();

    const nested = new Repo({
      ...manifest("Nested", { references: [repo.url] }),
      ...reviewFile({ [repo.url]: first }),
    });

    const root = collection({
      ...manifest("Root", { references: [nested.url] }),
      ...skill("skills/own", "own"),
    });

    const traversal = await traverse(parseSource(root, "/"), fetcher(), { reviewed: false });

    expect(traversal.skills.map((found) => [found.name, found.commit, found.reference])).toEqual([
      ["own", "local", undefined],
      ["up", first, nested.url],
    ]);
  });

  test("a broken review in a fetched Collection names its source", async () => {
    const nested = new Repo({ ...manifest("Nested"), [REVIEW_FILE]: "nope" });
    const root = collection(manifest("Root", { references: [nested.url] }));

    await expect(traverse(parseSource(root, "/"), fetcher())).rejects.toThrow(
      new RegExp(`^${REVIEW_FILE} of file://\\S+ at [0-9a-f]{7} is not valid JSON`),
    );
  });
});

describe("referenceStatuses and acceptReview", () => {
  test("reports every fetched Reference, then records the upstream commits", async () => {
    const { repo: moved, first } = movedUpstream();
    const still = new Repo(skill("s", "s"));
    const fresh = new Repo(skill("f", "f"));
    const missing = `file://${tempDir("missing")}/nothing`;

    const dir = collection({
      ...manifest("Kit", { references: [moved.url, still.url, fresh.url, missing, "./vendor"] }),
      ...skill("vendor/v", "v"),
      ...reviewFile({ [moved.url]: first, [still.url]: still.head(), gone: first }),
    });

    const statuses = await referenceStatuses(dir, fetcher());

    expect(statuses.map((status) => [status.key, reviewState(status)])).toEqual([
      [moved.url, "outdated"],
      [still.url, "reviewed"],
      [fresh.url, "floating"],
      [missing, "unreachable"],
    ]);
    expect(statuses[3]?.problem).toStartWith("Can't fetch");

    const accepted = await acceptReview(dir, statuses, [findReference(statuses, moved.url)]);

    expect(accepted).toEqual([{ key: moved.url, from: first, to: moved.head() }]);
    expect(await readReview(dir)).toEqual({
      version: 1,
      references: { [moved.url]: { commit: moved.head() }, [still.url]: { commit: still.head() } },
    });

    await acceptReview(dir, statuses, statuses);

    expect(Object.keys((await readReview(dir))?.references ?? {})).toEqual(
      [moved.url, still.url, fresh.url].toSorted((a, b) => a.localeCompare(b)),
    );
  });

  test("findReference takes a key or a formatted source, and names the References otherwise", async () => {
    const repo = new Repo(skill("sub/s", "s"));
    const dir = collection(manifest("Kit", { references: [{ source: repo.url, path: "sub" }] }));
    const statuses = await referenceStatuses(dir, fetcher());
    const key = `${repo.url} (sub)`;

    expect(findReference(statuses, key).key).toBe(key);
    expect(findReference(statuses, `${repo.url}//sub`).key).toBe(key);
    expect(() => findReference(statuses, "nope")).toThrow(
      new ScillaError(`No fetched Reference "nope" in this Collection. References: ${key}.`),
    );
    expect(() => findReference([], "nope")).toThrow("References: none.");
  });

  test("a Collection without scilla.json is refused", async () => {
    const dir = collection({});

    writeFileSync(join(dir, "README.md"), "not a Collection");

    await expect(referenceStatuses(dir, fetcher())).rejects.toThrow("is not a Collection");
  });
});
