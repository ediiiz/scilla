import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { AuditFetch } from "./audit.ts";
import { detectProvider, openPullRequest, parseRemote, type Provider } from "./forge.ts";

interface Sent {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  /** The JSON body, parsed; undefined for a GET. */
  readonly body: z.infer<ReturnType<typeof z.json>> | undefined;
}

const JsonText = z.string().transform((text) => z.json().parse(JSON.parse(text)));

/** A fetch that answers each request with the next of `answers`, and records what was sent. */
const forge = (answers: readonly (readonly [status: number, body: unknown])[]) => {
  const sent: Sent[] = [];
  const queue = [...answers];

  const fetch: AuditFetch = async (url, init) => {
    const [status, body] = queue.shift() ?? [500, "no answer left"];
    const headers = new Headers(init.headers);

    sent.push({
      method: init.method ?? "GET",
      url,
      headers: Object.fromEntries(headers.entries()),
      body: JsonText.optional().parse(init.body ?? undefined),
    });

    return new Response(JSON.stringify(body), { status });
  };

  return { fetch, sent };
};

const request = {
  title: "chore(review): bump",
  body: "Body",
  head: "scilla/review-updates",
  base: "main",
};

const open = (provider: Provider, remote: string, fetch: AuditFetch, env: Record<string, string>) =>
  openPullRequest(provider, parseRemote(remote), request, { fetch, env });

describe("parseRemote", () => {
  test.each([
    ["https://github.com/acme/skills.git", "https://github.com", ["acme", "skills"]],
    [
      "https://x-access-token:secret@git.example.com:8443/acme/skills/",
      "https://git.example.com:8443",
      ["acme", "skills"],
    ],
    ["http://localhost:3000/acme/skills", "http://localhost:3000", ["acme", "skills"]],
    [
      "ssh://git@git.example.com:2222/group/sub/skills.git",
      "https://git.example.com",
      ["group", "sub", "skills"],
    ],
    ["git@codeberg.org:acme/skills.git", "https://codeberg.org", ["acme", "skills"]],
    ["codeberg.org:acme/skills", "https://codeberg.org", ["acme", "skills"]],
  ])("%s", (url, origin, segments) => {
    expect(parseRemote(url)).toMatchObject({ origin, segments });
  });

  test("anything else is an error", () => {
    expect(() => parseRemote("/just/a/path")).toThrow('Can\'t read the remote URL "/just/a/path".');
  });
});

const remote = (url: string) => parseRemote(url);

describe("detectProvider", () => {
  test("an explicit provider wins, then known hosts, then the one token that's set", () => {
    expect(detectProvider(remote("https://github.com/a/b"), "gitea", {})).toBe("gitea");
    expect(detectProvider(remote("https://github.com/a/b"), undefined, {})).toBe("github");
    expect(detectProvider(remote("https://codeberg.org/a/b"), undefined, {})).toBe("forgejo");
    expect(detectProvider(remote("https://gitlab.example.com/a/b"), undefined, {})).toBe("gitlab");
    expect(
      detectProvider(remote("https://git.example.com/a/b"), undefined, { GITEA_TOKEN: "t" }),
    ).toBe("gitea");
    expect(
      detectProvider(remote("https://git.example.com/a/b"), undefined, { FORGEJO_TOKEN: "t" }),
    ).toBe("forgejo");
  });

  test("no telling, or two tokens, is undefined", () => {
    expect(detectProvider(remote("https://git.example.com/a/b"), undefined, {})).toBeUndefined();
    expect(
      detectProvider(remote("https://git.example.com/a/b"), undefined, {
        GITEA_TOKEN: "t",
        FORGEJO_TOKEN: "t",
      }),
    ).toBeUndefined();
  });
});

describe("openPullRequest", () => {
  test("GitHub: opens a pull request when none is open for the branch", async () => {
    const { fetch, sent } = forge([
      [200, []],
      [201, { number: 7, html_url: "https://github.com/acme/skills/pull/7" }],
    ]);

    const opened = await open("github", "https://github.com/acme/skills.git", fetch, {
      GITHUB_TOKEN: "gh",
    });

    expect(opened).toEqual({
      url: "https://github.com/acme/skills/pull/7",
      number: 7,
      updated: false,
    });
    expect(sent.map((call) => [call.method, call.url])).toEqual([
      [
        "GET",
        "https://api.github.com/repos/acme/skills/pulls?state=open&head=acme%3Ascilla%2Freview-updates",
      ],
      ["POST", "https://api.github.com/repos/acme/skills/pulls"],
    ]);
    expect(sent[1]?.headers).toMatchObject({
      authorization: "Bearer gh",
      accept: "application/vnd.github+json",
    });
    expect(sent[1]?.body).toEqual({ ...request });
  });

  test("GitHub Enterprise: uses GITHUB_API_URL, and updates the open pull request", async () => {
    const { fetch, sent } = forge([
      [200, [{ number: 3, html_url: "u", head: { ref: "scilla/review-updates" } }]],
      [200, { number: 3, html_url: "https://ghe.example.com/acme/skills/pull/3" }],
    ]);

    const env = { GITHUB_TOKEN: "gh", GITHUB_API_URL: "https://ghe.example.com/api/v3" };
    const opened = await open("github", "https://ghe.example.com/acme/skills", fetch, env);

    expect(opened).toMatchObject({ number: 3, updated: true });
    expect(sent[1]).toMatchObject({
      method: "PATCH",
      url: "https://ghe.example.com/api/v3/repos/acme/skills/pulls/3",
      body: { title: request.title, body: request.body },
    });
  });

  test("Gitea: opens one through /api/v1 with token auth", async () => {
    const { fetch, sent } = forge([
      [200, [{ number: 1, html_url: "other", head: { ref: "feature" } }]],
      [201, { number: 2, html_url: "https://git.example.com/acme/skills/pulls/2" }],
    ]);

    const opened = await open("gitea", "git@git.example.com:acme/skills.git", fetch, {
      FORGEJO_TOKEN: "fj",
    });

    expect(opened).toMatchObject({ number: 2, updated: false });
    expect(sent.map((call) => [call.method, call.url])).toEqual([
      ["GET", "https://git.example.com/api/v1/repos/acme/skills/pulls?state=open&limit=50"],
      ["POST", "https://git.example.com/api/v1/repos/acme/skills/pulls"],
    ]);
    expect(sent[1]?.headers).toMatchObject({ authorization: "token fj" });
  });

  test("Forgejo under a sub-path: updates the open pull request", async () => {
    const { fetch, sent } = forge([
      [200, [{ number: 9, html_url: "x", head: { ref: "scilla/review-updates" } }]],
      [200, { number: 9, html_url: "https://example.com/forge/acme/skills/pulls/9" }],
    ]);

    await open("forgejo", "https://example.com/forge/acme/skills.git", fetch, {
      FORGEJO_TOKEN: "fj",
    });

    expect(sent[1]?.url).toBe("https://example.com/forge/api/v1/repos/acme/skills/pulls/9");
  });

  test("GitLab: opens a merge request with CI_JOB_TOKEN, and updates one with GITLAB_TOKEN", async () => {
    const created = forge([
      [200, []],
      [201, { iid: 4, web_url: "https://gitlab.com/g/sub/skills/-/merge_requests/4" }],
    ]);

    const opened = await open("gitlab", "https://gitlab.com/g/sub/skills.git", created.fetch, {
      CI_JOB_TOKEN: "job",
    });

    expect(opened).toMatchObject({ number: 4, updated: false });
    expect(created.sent[0]?.url).toBe(
      "https://gitlab.com/api/v4/projects/g%2Fsub%2Fskills/merge_requests?state=opened&source_branch=scilla%2Freview-updates",
    );
    expect(created.sent[1]).toMatchObject({
      method: "POST",
      headers: { "job-token": "job" },
      body: {
        title: request.title,
        description: "Body",
        source_branch: request.head,
        target_branch: "main",
      },
    });

    const updated = forge([
      [200, [{ iid: 4, web_url: "w" }]],
      [200, { iid: 4, web_url: "w" }],
    ]);

    await open("gitlab", "https://gitlab.com/g/skills", updated.fetch, { GITLAB_TOKEN: "pat" });

    expect(updated.sent[1]).toMatchObject({ method: "PUT", headers: { "private-token": "pat" } });
  });

  test("a missing token, a refusal, an odd answer or a repo path without an owner fail clearly", async () => {
    const none = forge([]);

    await expect(open("github", "https://github.com/a/b", none.fetch, {})).rejects.toThrow(
      "Set GITHUB_TOKEN to open a pull request on github.",
    );
    await expect(
      open("gitea", "https://git.example.com/a/b", forge([[403, "no"]]).fetch, {
        GITEA_TOKEN: "t",
      }),
    ).rejects.toThrow(
      /^gitea answered GET https:\/\/git\.example\.com\/api\/v1\/repos\/a\/b\/pulls\?state=open&limit=50 with 403: "no"$/,
    );
    await expect(
      open("gitea", "https://git.example.com/a/b", forge([[200, {}]]).fetch, { GITEA_TOKEN: "t" }),
    ).rejects.toThrow("gitea sent an unexpected answer");
    await expect(
      open("gitea", "https://git.example.com/solo", none.fetch, { GITEA_TOKEN: "t" }),
    ).rejects.toThrow("Can't find the owner and repo");
  });
});
