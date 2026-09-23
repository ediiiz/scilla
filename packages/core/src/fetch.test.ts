import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ScillaError } from "./errors.ts";
import { Fetcher, probeSource } from "./fetch.ts";
import { parseSource } from "./source.ts";
import { cleanup, fetcher, Repo, skill, tempDir } from "./testing/fixtures.ts";

afterAll(cleanup);

const source = (raw: string) => parseSource(raw, "/");

describe("Fetcher", () => {
  test("checks out HEAD, a tag and a branch at their commits", async () => {
    const repo = new Repo(skill("s", "s"));
    const tagged = repo.head();

    repo.tag("v1");

    const branched = repo.branch("feature", skill("f", "f"));
    const head = repo.commit(skill("t", "t"));
    const cache = fetcher();

    expect((await cache.checkout(source(repo.url))).commit).toBe(head);
    expect((await cache.checkout(source(`${repo.url}#v1`))).commit).toBe(tagged);

    const feature = await cache.checkout(source(`${repo.url}#feature`));

    expect(feature.commit).toBe(branched);
    expect(existsSync(join(feature.root, "f", "SKILL.md"))).toBe(true);
    expect(existsSync(join(feature.root, "t"))).toBe(false);
  });

  test("shares one checkout between concurrent requests for a commit", async () => {
    const repo = new Repo(skill("s", "s"));
    const cache = fetcher();

    const [a, b] = await Promise.all([
      cache.checkout(source(repo.url)),
      cache.checkout(source(repo.url)),
    ]);

    expect(a).toEqual(b);
  });

  test("reads local sources in place", async () => {
    const dir = tempDir();

    expect(await fetcher().checkout(source(dir))).toEqual({ root: dir, commit: "local" });
    await expect(fetcher().checkout(source(join(dir, "missing")))).rejects.toThrow(ScillaError);
  });

  test("fails on a missing repo or Pin", async () => {
    const repo = new Repo(skill("s", "s"));

    // The git failure reads as one sentence, without an error class name in it.
    await expect(fetcher().checkout(source(`file://${tempDir()}/nope`))).rejects.toThrow(
      /^Can't fetch file:\/\/\S+: git clone failed: fatal: [^\n]+$/,
    );
    await expect(fetcher().checkout(source(`${repo.url}#no-such-ref`))).rejects.toThrow(
      /Pin "no-such-ref"/,
    );
  });

  test("picks up upstream commits in a later run and falls back to the cache offline", async () => {
    const repo = new Repo(skill("s", "s"));
    const cacheDir = tempDir("cache");
    const first = await new Fetcher(cacheDir).checkout(source(repo.url));
    const next = repo.commit(skill("t", "t"));

    expect((await new Fetcher(cacheDir).checkout(source(repo.url))).commit).toBe(next);

    rmSync(repo.dir, { recursive: true, force: true });

    const offline = new Fetcher(cacheDir);

    expect((await offline.checkout(source(repo.url))).commit).toBe(next);
    expect((await offline.checkout(source(`${repo.url}#${first.commit}`))).commit).toBe(
      first.commit,
    );
    expect(offline.warnings).toEqual([
      expect.stringMatching(
        /^Using cached \S+; fetch failed \(git remote failed: fatal: [^\n]+\)\.$/,
      ),
    ]);
    expect(offline.details.get(offline.warnings[0] ?? "")).toContain("fatal:");
  });

  test("keeps git's full stderr as the error's detail", async () => {
    const checkout = fetcher().checkout(source(`file://${tempDir()}/nope`));
    const failure = await checkout.catch((cause) => cause);

    // The first `fatal:` line is the specific one; the generic one after it stays in the detail.
    expect(failure).toBeInstanceOf(ScillaError);
    expect(failure.message).toEndWith("does not appear to be a git repository");
    expect(failure.message).not.toContain("Could not read from remote repository");
    expect(failure.detail).toContain("fatal: Could not read from remote repository.");
    expect(failure.detail).toContain("\n");
  });

  test("names cache folders by a sha256 of the URL", async () => {
    const repo = new Repo(skill("s", "s"));
    const cacheDir = tempDir("cache");
    const checkout = await new Fetcher(cacheDir).checkout(source(repo.url));
    const key = new Bun.CryptoHasher("sha256").update(repo.url).digest("hex").slice(0, 32);

    expect(existsSync(join(cacheDir, "repos", key))).toBe(true);
    expect(checkout.root).toBe(join(cacheDir, "checkouts", key, checkout.commit));
  });

  test("defaults its cache to $SCILLA_CACHE_DIR", async () => {
    const repo = new Repo(skill("s", "s"));

    process.env["SCILLA_CACHE_DIR"] = tempDir("cache");

    const checkout = await new Fetcher().checkout(source(repo.url));

    expect(checkout.root.startsWith(process.env["SCILLA_CACHE_DIR"] ?? "unset")).toBe(true);
  });
});

describe("probeSource", () => {
  test("passes a reachable repo, its branches and tags, a commit Pin and local sources", async () => {
    const repo = new Repo(skill("s", "s"));

    repo.tag("v1");

    expect(await probeSource(source(repo.url))).toBeUndefined();
    expect(await probeSource(source(`${repo.url}#main`))).toBeUndefined();
    expect(await probeSource(source(`${repo.url}#v1`))).toBeUndefined();
    expect(await probeSource(source(`${repo.url}#${repo.head()}`))).toBeUndefined();
    expect(await probeSource(source(join(tempDir(), "missing")))).toBeUndefined();
  });

  test("says why a repo or Pin can't be reached, in one line", async () => {
    const repo = new Repo(skill("s", "s"));
    const missing = `file://${tempDir()}/nope`;

    expect(await probeSource(source(`${repo.url}#no-such-ref`))).toBe(
      `Pin "no-such-ref" not found in ${repo.url}.`,
    );
    expect(await probeSource(source(missing))).toMatch(
      /^Can't reach file:\/\/\S+: git ls-remote failed: fatal: \S+ does not appear to be a git repository$/,
    );
  });

  test("gives up on a remote that doesn't answer in time", async () => {
    // A stand-in ssh that hangs: git never touches the network, and the probe has to kill it.
    process.env["GIT_SSH_COMMAND"] = "exec sleep 5 #";

    const started = performance.now();

    try {
      expect(
        await probeSource(source("ssh://git@example.invalid/hangs.git"), { timeout: 200 }),
      ).toBe(
        "Can't reach ssh://git@example.invalid/hangs.git: git ls-remote gave no answer within 0.2 s.",
      );
    } finally {
      delete process.env["GIT_SSH_COMMAND"];
    }

    expect(performance.now() - started).toBeLessThan(3000);
  });
});
