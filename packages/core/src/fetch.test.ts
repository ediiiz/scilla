import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ScillaError } from "./errors.ts";
import { CACHE_TAG, Fetcher, probeSource } from "./fetch.ts";
import { parseSource } from "./source.ts";
import { cleanup, fetcher, Repo, skill, tempDir } from "./testing/fixtures.ts";

afterAll(cleanup);

const source = (raw: string) => parseSource(raw, "/");

const key = (url: string) => new Bun.CryptoHasher("sha256").update(url).digest("hex").slice(0, 32);

const at = (url: string, path: string) => ({ ...source(url), path });

const restoreEnv = (name: string, value: string | undefined) => {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
};

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

  test("checkoutCommit uses a cached checkout or store before fetching anything", async () => {
    const repo = new Repo(skill("s", "s"));
    const first = repo.head();
    const second = repo.commit(skill("t", "t"));
    const cacheDir = tempDir("cache");

    await new Fetcher(cacheDir).checkout(source(`${repo.url}#${first}`));
    await new Fetcher(cacheDir).checkout(source(repo.url));
    rmSync(join(cacheDir, "checkouts", key(repo.url), first), { recursive: true });
    rmSync(repo.dir, { recursive: true, force: true });

    // The repo is gone: the store (for `first`) and the checkout (for `second`) must do.
    const old = await new Fetcher(cacheDir).checkoutCommit(source(repo.url), first);
    const known = await new Fetcher(cacheDir).checkoutCommit(source(repo.url), second);

    expect(old.commit).toBe(first);
    expect(existsSync(join(old.root, "s", "SKILL.md"))).toBe(true);
    expect(existsSync(join(old.root, "t"))).toBe(false);
    expect(existsSync(join(known.root, "t", "SKILL.md"))).toBe(true);
  });

  test("checkoutCommit fetches a commit the cache lacks and reads local folders in place", async () => {
    const repo = new Repo(skill("s", "s"));
    const cacheDir = tempDir("cache");

    await new Fetcher(cacheDir).checkout(source(repo.url));

    const later = repo.commit(skill("t", "t"));
    const checkout = await new Fetcher(cacheDir).checkoutCommit(source(repo.url), later);
    const dir = tempDir();

    expect(checkout.commit).toBe(later);
    expect(await fetcher().checkoutCommit(source(dir), "local")).toEqual({
      root: dir,
      commit: "local",
    });
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
      /^Can't fetch file:\/\/\S+: git fetch failed: fatal: [^\n]+$/,
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
        /^Using cached \S+; fetch failed \(git fetch failed: fatal: [^\n]+\)\.$/,
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

  test("checks out only the source's path, and the whole repo for the root", async () => {
    const repo = new Repo({ ...skill("skills/a", "a"), ...skill("examples/deep", "deep") });
    const cache = fetcher();
    const skills = await cache.checkout(at(repo.url, "skills"));
    const whole = await cache.checkout(source(repo.url));

    expect(existsSync(join(skills.root, "skills", "a", "SKILL.md"))).toBe(true);
    expect(existsSync(join(skills.root, "examples"))).toBe(false);
    expect(existsSync(join(whole.root, "examples", "deep", "SKILL.md"))).toBe(true);
  });

  test("reuses a checkout of a folder above the path, in this run or a cached one", async () => {
    const repo = new Repo({ ...skill("skills/a", "a"), ...skill("skills/b", "b") });
    const cacheDir = tempDir("cache");
    const cache = new Fetcher(cacheDir);

    const [skills, a] = await Promise.all([
      cache.checkout(at(repo.url, "skills")),
      cache.checkout(at(repo.url, "skills/a")),
    ]);

    const b = await new Fetcher(cacheDir).checkoutCommit(at(repo.url, "skills/b"), a.commit);

    expect(a.root).toBe(skills.root);
    expect(b.root).toBe(skills.root);
  });

  test("fetches only the commit and the files under the source's path", async () => {
    const repo = new Repo({ ...skill("skills/a", "a"), "examples/big.txt": "x".repeat(10_000) });

    repo.commit(skill("skills/b", "b"));

    const cacheDir = tempDir("cache");
    const checkout = await new Fetcher(cacheDir).checkout(at(repo.url, "skills"));

    const has = (object: string) =>
      Bun.spawnSync(["git", "cat-file", "-e", object], {
        cwd: join(cacheDir, "repos", key(repo.url)),
        env: { ...process.env, GIT_NO_LAZY_FETCH: "1" },
      }).exitCode === 0;

    expect(has(`${checkout.commit}:skills/a/SKILL.md`)).toBe(true);
    expect(has(`${checkout.commit}:examples/big.txt`)).toBe(false);
    expect(has(`${checkout.commit}~1`)).toBe(false);
  });

  test("resolves a Pin only git rev-parse understands, such as HEAD~1 or a short SHA", async () => {
    const repo = new Repo(skill("s", "s"));
    const first = repo.head();

    repo.commit(skill("t", "t"));

    const cache = fetcher();

    expect((await cache.checkout(source(`${repo.url}#HEAD~1`))).commit).toBe(first);
    expect((await cache.checkout(source(`${repo.url}#${first.slice(0, 7)}`))).commit).toBe(first);
  });

  test("names cache folders by a sha256 of the URL", async () => {
    const repo = new Repo(skill("s", "s"));
    const cacheDir = tempDir("cache");
    const checkout = await new Fetcher(cacheDir).checkout(source(repo.url));
    expect(existsSync(join(cacheDir, "repos", key(repo.url)))).toBe(true);
    expect(checkout.root).toBe(join(cacheDir, "checkouts", key(repo.url), checkout.commit));
  });

  test("tags repos/ and checkouts/ as caches, also in a cache made before tags existed", async () => {
    const repo = new Repo(skill("s", "s"));
    const cacheDir = tempDir("cache");

    await new Fetcher(cacheDir).checkout(source(repo.url));
    rmSync(join(cacheDir, "repos", CACHE_TAG));
    rmSync(join(cacheDir, "checkouts", CACHE_TAG));
    await new Fetcher(cacheDir).checkout(source(repo.url));

    for (const dir of ["repos", "checkouts"]) {
      expect(readFileSync(join(cacheDir, dir, CACHE_TAG), "utf8")).toStartWith(
        "Signature: 8a477f597d28d172789f06886806bc55",
      );
    }
  });

  test("defaults its cache to $SCILLA_CACHE_DIR", async () => {
    const repo = new Repo(skill("s", "s"));

    process.env["SCILLA_CACHE_DIR"] = tempDir("cache");

    const checkout = await new Fetcher().checkout(source(repo.url));

    expect(checkout.root.startsWith(process.env["SCILLA_CACHE_DIR"] ?? "unset")).toBe(true);
  });

  test("treats an empty or blank $SCILLA_CACHE_DIR and $XDG_CACHE_HOME as unset", async () => {
    const repo = new Repo(skill("s", "s"));
    const saved = { cache: process.env["SCILLA_CACHE_DIR"], xdg: process.env["XDG_CACHE_HOME"] };
    const xdg = tempDir("xdg");

    try {
      // A blank $XDG_CACHE_HOME would fall back to the real home; `envValue`'s own test covers it.
      Object.assign(process.env, { SCILLA_CACHE_DIR: "", XDG_CACHE_HOME: xdg });

      expect((await new Fetcher().checkout(source(repo.url))).root).toStartWith(
        join(xdg, "scilla", "checkouts"),
      );

      Object.assign(process.env, { SCILLA_CACHE_DIR: " \t" });

      expect((await new Fetcher().checkout(source(repo.url))).root).toStartWith(
        join(xdg, "scilla", "checkouts"),
      );
      expect(existsSync(join(process.cwd(), "repos"))).toBe(false);
      expect(existsSync(join(process.cwd(), "checkouts"))).toBe(false);
    } finally {
      restoreEnv("SCILLA_CACHE_DIR", saved.cache);
      restoreEnv("XDG_CACHE_HOME", saved.xdg);
    }
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
