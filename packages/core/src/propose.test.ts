import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { commitProposal, originUrl, pushProposal, REVIEW_BRANCH } from "./propose.ts";
import { REVIEW_FILE, referenceStatuses, reviewState } from "./review.ts";
import { cleanup, fetcher, manifest, Repo, skill, tempDir } from "./testing/fixtures.ts";

afterAll(cleanup);

// commitProposal commits through the user's git, which has no identity in the test sandbox.
Object.assign(process.env, {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
});

const git = (dir: string, ...args: string[]) => {
  const result = Bun.spawnSync(["git", ...args], { cwd: dir });

  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`);
  }

  return result.stdout.toString().trim();
};

/** A Collection checkout whose one Reference moved past its reviewed commit, with a bare origin. */
const outdatedCollection = () => {
  const upstream = new Repo(skill("up", "up"));
  const reviewed = upstream.head();

  upstream.commit(skill("up", "up", "newer"));

  const review = { version: 1, references: { [upstream.url]: { commit: reviewed } } };

  const collection = new Repo({
    ...manifest("Kit", { references: [upstream.url] }),
    [REVIEW_FILE]: JSON.stringify(review),
  });

  const origin = tempDir("origin");

  git(origin, "init", "--quiet", "--bare");
  git(collection.dir, "remote", "add", "origin", origin);

  return { upstream, reviewed, collection, origin };
};

const statusesOf = async (dir: string) => {
  const all = await referenceStatuses(dir, fetcher());

  return { all, outdated: all.filter((status) => reviewState(status) === "outdated") };
};

const message = () => ({ subject: "chore(review): bump", body: "Details." });

describe("commitProposal", () => {
  test("commits the bumped review on the review branch and switches back", async () => {
    const { upstream, reviewed, collection } = outdatedCollection();
    const { all, outdated } = await statusesOf(collection.dir);
    const before = readFileSync(join(collection.dir, REVIEW_FILE), "utf8");
    const proposal = await commitProposal(collection.dir, all, outdated, message);

    expect(proposal).toMatchObject({
      base: "main",
      branch: REVIEW_BRANCH,
      accepted: [{ key: upstream.url, from: reviewed, to: upstream.head() }],
    });
    expect(git(collection.dir, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(readFileSync(join(collection.dir, REVIEW_FILE), "utf8")).toBe(before);
    expect(git(collection.dir, "log", "--format=%s%n%b", "-1", REVIEW_BRANCH)).toBe(
      "chore(review): bump\nDetails.",
    );
    expect(git(collection.dir, "show", `${REVIEW_BRANCH}:${REVIEW_FILE}`)).toContain(
      upstream.head(),
    );

    // A second run resets the branch onto main instead of stacking commits.
    await commitProposal(collection.dir, all, outdated, message);

    expect(git(collection.dir, "rev-list", "--count", `main..${REVIEW_BRANCH}`)).toBe("1");
  });

  test("pushes the branch to origin", async () => {
    const { collection, origin } = outdatedCollection();
    const { all, outdated } = await statusesOf(collection.dir);
    const proposal = await commitProposal(collection.dir, all, outdated, message);

    await pushProposal(collection.dir, proposal.branch);

    expect(await originUrl(collection.dir)).toBe(origin);
    expect(git(origin, "rev-parse", REVIEW_BRANCH)).toBe(proposal.commit);
  });

  test("refuses a detached HEAD and uncommitted review changes", async () => {
    const { collection } = outdatedCollection();
    const { all, outdated } = await statusesOf(collection.dir);

    writeFileSync(join(collection.dir, REVIEW_FILE), "{}");

    await expect(commitProposal(collection.dir, all, outdated, message)).rejects.toThrow(
      `${REVIEW_FILE} has uncommitted changes`,
    );

    git(collection.dir, "checkout", "--quiet", "--", REVIEW_FILE);
    git(collection.dir, "checkout", "--quiet", "--detach");

    await expect(commitProposal(collection.dir, all, outdated, message)).rejects.toThrow(
      "HEAD is detached",
    );
  });
});
