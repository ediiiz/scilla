import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AuditFetch } from "@scilla/core";
import {
  cli,
  gitFixture,
  manifestFile,
  plant,
  removeTemps,
  skillAt,
  temp,
} from "./testing/harness.ts";

afterAll(removeTemps);

// `review propose` commits through the user's own git, which has no identity in the sandbox.
Object.assign(process.env, {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
});

const git = (dir: string, ...args: string[]) =>
  execFileSync("git", args, { cwd: dir }).toString().trim();

const reviewFile = (key: string, commit: string) => ({
  "scilla-review.json": JSON.stringify({ version: 1, references: { [key]: { commit } } }),
});

/**
 * A Collection checkout (a git repo whose origin is a Gitea-style URL, pushed to a local bare
 * repo) reviewing one Reference that moved on: `up` changed and gained a script.
 */
const proposable = () => {
  const upstream = gitFixture(skillAt("up", "up"));
  const reviewed = git(upstream.dir, "rev-parse", "HEAD");

  upstream.commit({
    "up/SKILL.md": "---\nname: up\ndescription: newer\n---\n",
    "up/scripts/run.sh": "echo hi\n",
  });

  const collection = gitFixture({
    ...manifestFile("Kit", { references: [upstream.url] }),
    ...reviewFile(upstream.url, reviewed),
  });

  const bare = temp("origin");

  git(bare, "init", "--quiet", "--bare");
  git(collection.dir, "remote", "add", "origin", "https://git.example.com/acme/kit.git");
  git(collection.dir, "remote", "set-url", "--push", "origin", bare);

  return { upstream, reviewed, collection, bare };
};

describe("review accept", () => {
  test("records one Reference, refuses an unknown one, and says when nothing moved", async () => {
    const upstream = gitFixture(skillAt("up", "up"));
    const other = gitFixture(skillAt("o", "o"));

    const dir = plant(
      temp("collection"),
      manifestFile("Kit", { references: [upstream.url, other.url] }),
    );

    const one = await cli(["review", "accept", upstream.url], { cwd: dir });

    expect(one.code).toBe(0);
    expect(one.stdout).toMatch(
      /^Reviewed file:\S+: floating → [0-9a-f]{7}\nCommit scilla-review.json/,
    );
    expect(
      Object.keys(JSON.parse(readFileSync(join(dir, "scilla-review.json"), "utf8")).references),
    ).toEqual([upstream.url]);
    expect((await cli(["review", "accept", upstream.url], { cwd: dir })).stdout).toBe(
      "Nothing to accept: every Reference is at its reviewed commit.\n",
    );
    expect(await cli(["review", "accept", "nope"], { cwd: dir })).toMatchObject({
      code: 1,
      stderr: expect.stringContaining('No fetched Reference "nope"'),
    });
  });

  test("leaves an unreachable Reference as it was, with a warning", async () => {
    const missing = `file://${temp("gone")}/nothing`;
    const dir = plant(temp("collection"), manifestFile("Kit", { references: [missing] }));
    const result = await cli(["review", "accept"], { cwd: dir });

    expect(result.stderr).toContain(`warning: Reference "${missing}" left as it was: Can't fetch`);
    expect(result.stdout).toBe("Nothing to accept: every Reference is at its reviewed commit.\n");
  });

  test("outside a Collection is an error", async () => {
    expect((await cli(["review", "accept"])).stderr).toContain("is not a Collection");
  });
});

describe("review propose", () => {
  test("commits the bump on scilla/review-updates and prints the PR title and body", async () => {
    const { upstream, reviewed, collection } = proposable();
    const result = await cli(["review", "propose"], { cwd: collection.dir });
    const move = `${reviewed.slice(0, 7)} → ${git(upstream.dir, "rev-parse", "--short=7", "HEAD")}`;

    expect(result.code).toBe(0);
    expect(result.stdout).toStartWith(
      `chore(review): bump the reviewed commit of ${upstream.url}\n\n## Reviewed updates\n`,
    );
    expect(result.stdout).toContain(`| \`${upstream.url}\` | ${move} |`);
    expect(result.stdout).toContain("| `up` | changed | M SKILL.md, A scripts/run.sh |");
    expect(result.stdout).toContain(
      "- ⚠ **Can run code, new or changed** in `up`: scripts/run.sh (added)",
    );
    expect(result.stdout).toContain("<details><summary>Diff of <code>up</code>");
    expect(result.stdout).toContain("+description: newer");
    expect(result.stdout).toContain("Run `scilla diff` in a checkout of this Collection");
    expect(result.stderr).toMatch(
      /^Committed [0-9a-f]{7} on scilla\/review-updates \(from main\)\.\n/,
    );
    expect(result.stderr).toContain(
      "Push it with: git push --force origin scilla/review-updates\n",
    );
    expect(git(collection.dir, "log", "-1", "--format=%s", "scilla/review-updates")).toBe(
      `chore(review): bump the reviewed commit of ${upstream.url}`,
    );
    expect(git(collection.dir, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
  });

  test("leaves out a diff too long for a PR body, and says so", async () => {
    const { upstream, collection } = proposable();

    upstream.commit({ "up/big.txt": "line of text\n".repeat(3000) });

    const { stdout } = await cli(["review", "propose", "--no-audit"], { cwd: collection.dir });

    expect(stdout).toContain("_The diff of `up` is too long to show here._");
    expect(stdout).toContain("Some diffs are left out to keep this short.");
    expect(stdout).not.toContain("+line of text");
  });

  test("--title-file and --body-file write the files instead", async () => {
    const { collection } = proposable();
    const out = temp("out");

    const result = await cli(
      ["review", "propose", "--title-file", join(out, "title"), "--body-file", join(out, "body")],
      { cwd: collection.dir },
    );

    expect(result.stdout).toBe("");
    expect(readFileSync(join(out, "title"), "utf8")).toStartWith("chore(review): bump");
    expect(readFileSync(join(out, "body"), "utf8")).toStartWith("## Reviewed updates\n");

    const titleOnly = await cli(["review", "propose", "--body-file", join(out, "body2")], {
      cwd: collection.dir,
    });

    expect(titleOnly.stdout).toStartWith("chore(review): bump");
    expect(titleOnly.stdout).not.toContain("## Reviewed updates");
  });

  test("--open pushes the branch and opens the pull request on Gitea", async () => {
    const { collection, bare } = proposable();
    const sent: string[] = [];

    const fetch: AuditFetch = (url, init) => {
      sent.push(`${init.method ?? "GET"} ${url}`);

      return Promise.resolve(
        init.method === "POST"
          ? Response.json(
              { number: 5, html_url: "https://git.example.com/acme/kit/pulls/5" },
              { status: 201 },
            )
          : Response.json([]),
      );
    };

    const result = await cli(["review", "propose", "--open", "--provider", "gitea", "--no-audit"], {
      cwd: collection.dir,
      fetch,
      env: { GITEA_TOKEN: "secret" },
    });

    expect(result.code).toBe(0);
    expect(result.stderr).toContain("Opened https://git.example.com/acme/kit/pulls/5\n");
    expect(sent).toEqual([
      "GET https://git.example.com/api/v1/repos/acme/kit/pulls?state=open&limit=50",
      "POST https://git.example.com/api/v1/repos/acme/kit/pulls",
    ]);
    expect(git(bare, "rev-parse", "scilla/review-updates")).toBe(
      git(collection.dir, "rev-parse", "scilla/review-updates"),
    );
  });

  test("--open on a host it can't tell fails before committing anything", async () => {
    const { collection } = proposable();
    const result = await cli(["review", "propose", "--open"], { cwd: collection.dir });

    expect(result).toMatchObject({
      code: 1,
      stderr:
        "error: Can't tell which forge hosts git.example.com; pass --provider github|gitea|forgejo|gitlab.\n",
    });
    expect(() =>
      git(collection.dir, "rev-parse", "--verify", "--quiet", "scilla/review-updates"),
    ).toThrow();
  });

  test("with every Reference at its reviewed commit there is nothing to propose", async () => {
    const upstream = gitFixture(skillAt("up", "up"));

    const collection = gitFixture({
      ...manifestFile("Kit", { references: [upstream.url] }),
      ...reviewFile(upstream.url, git(upstream.dir, "rev-parse", "HEAD")),
    });

    expect(await cli(["review", "propose"], { cwd: collection.dir })).toMatchObject({
      code: 0,
      stdout: "",
      stderr: "Nothing to propose: every reviewed Reference is at its reviewed commit.\n",
    });
    expect((await cli(["review", "propose"])).stderr).toContain(
      "is not a Collection (no scilla.json)",
    );
  });
});
