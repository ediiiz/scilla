import { describe, expect, test } from "bun:test";
import { auditSkills, type AuditFetch, type AuditTarget } from "./audit.ts";

const github = (name: string, repo: string): AuditTarget => ({
  name,
  kind: "github",
  url: `https://github.com/${repo}.git`,
});

const PUBLIC = { id: 1, private: false, full_name: "x" };

// Trimmed from a real response for vercel-labs/agent-skills.
const RATINGS = {
  "react-best-practices": {
    ath: { risk: "safe", analyzedAt: "2026-01-01T00:00:00Z" },
    socket: { risk: "safe", alerts: 0, score: 90, analyzedAt: "2026-01-01T00:00:00Z" },
    snyk: { risk: "low", analyzedAt: "2026-01-01T00:00:00Z" },
  },
  "web-design-guidelines": {
    zeroleaks: { risk: "safe", score: 93 },
    brandnew: { risk: "high" },
    ath: { risk: "medium" },
    broken: { risk: "catastrophic" },
    odd: { risk: "low", alerts: "many" },
  },
  "no-data": {},
};

type Json = string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json };

const json = (body: Json, status = 200) => Response.json(body, { status });

/** Never answers; rejects only when the request is aborted. */
const hang: AuditFetch = (_url, init) =>
  new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  });

/** A fetch stub: answers each URL from `routes` (a missing route is a 404), recording every request. */
const stub = (routes: ReadonlyMap<string, () => Promise<Response>>) => {
  const requests: string[] = [];

  const get: AuditFetch = (url) => {
    requests.push(url);

    return routes.get(url)?.() ?? Promise.resolve(json({ message: "Not Found" }, 404));
  };

  return { get, requests };
};

const repoUrl = (repo: string) => `https://api.github.com/repos/${repo}`;

const auditUrl = (repo: string, skills: string) =>
  `https://add-skill.vercel.sh/audit?${new URLSearchParams({ source: repo, skills })}`;

const NO_ENV = {};

describe("auditSkills", () => {
  test("asks once per public repo and reads each provider's rating", async () => {
    const { get, requests } = stub(
      new Map([
        [repoUrl("vercel-labs/agent-skills"), () => Promise.resolve(json(PUBLIC))],
        [
          auditUrl(
            "vercel-labs/agent-skills",
            "react-best-practices,web-design-guidelines,no-data",
          ),
          () => Promise.resolve(json(RATINGS)),
        ],
      ]),
    );

    const skills = ["react-best-practices", "web-design-guidelines", "no-data"].map((name) =>
      github(name, "vercel-labs/agent-skills"),
    );

    const report = await auditSkills(skills, { fetch: get, env: NO_ENV });

    expect(requests).toHaveLength(2);
    expect(report.audits.get("react-best-practices")).toEqual({
      providers: [
        { id: "ath", label: "Gen", risk: "safe", alerts: undefined, score: undefined },
        { id: "socket", label: "Socket", risk: "safe", alerts: 0, score: 90 },
        { id: "snyk", label: "Snyk", risk: "low", alerts: undefined, score: undefined },
      ],
      worst: "low",
      detailsUrl: "https://skills.sh/vercel-labs/agent-skills",
    });

    // Known providers first, unknown ones by id with the id as label; unreadable entries dropped.
    const web = report.audits.get("web-design-guidelines");

    expect(web?.providers.map((provider) => `${provider.label}:${provider.risk}`)).toEqual([
      "Gen:medium",
      "ZeroLeaks:safe",
      "brandnew:high",
      "odd:low",
    ]);
    expect(web?.worst).toBe("high");
    expect(report.audits.has("no-data")).toBe(false);
    expect(report.unaudited).toEqual(new Map([["no-data", "no-data"]]));
  });

  test("never sends the names of private, missing or non-GitHub skills", async () => {
    const { get, requests } = stub(
      new Map([
        [repoUrl("acme/secret"), () => Promise.resolve(json({ private: true }))],
        [repoUrl("acme/limited"), () => Promise.resolve(json({ message: "rate limited" }, 403))],
      ]),
    );

    const report = await auditSkills(
      [
        github("secret", "acme/secret"),
        github("limited", "acme/limited"),
        github("gone", "acme/gone"),
        { name: "gitlab", kind: "git", url: "https://gitlab.example.com/a/b.git" },
        { name: "hosted", kind: "git", url: "https://github.com/acme/hosted.git" },
        { name: "mine", kind: "local", url: "/work/skills" },
      ],
      { fetch: get, env: NO_ENV },
    );

    expect(requests.toSorted()).toEqual(
      ["acme/gone", "acme/limited", "acme/secret"].map((repo) => repoUrl(repo)),
    );
    expect(report.audits.size).toBe(0);
    expect(report.unaudited).toEqual(
      new Map([
        ["gitlab", "not-github"],
        ["hosted", "not-github"],
        ["mine", "not-github"],
        ["secret", "not-public"],
        ["limited", "not-public"],
        ["gone", "not-public"],
      ]),
    );
  });

  test.each([
    ["enabled: false", { enabled: false, env: NO_ENV }],
    ["DO_NOT_TRACK", { env: { DO_NOT_TRACK: "1" } }],
    ["DISABLE_TELEMETRY", { env: { DISABLE_TELEMETRY: "true" } }],
    ["SCILLA_NO_AUDIT", { env: { SCILLA_NO_AUDIT: "1" } }],
  ])("%s sends nothing", async (_label, options) => {
    const { get, requests } = stub(new Map());
    const report = await auditSkills([github("a", "o/r")], { ...options, fetch: get });

    expect(requests).toEqual([]);
    expect(report.unaudited).toEqual(new Map([["a", "disabled"]]));
  });

  test("an empty opt-out variable doesn't opt out", async () => {
    const { get, requests } = stub(new Map());

    await auditSkills([github("a", "o/r")], { fetch: get, env: { DO_NOT_TRACK: "" } });

    expect(requests).toEqual([repoUrl("o/r")]);
  });

  test.each<[string, () => Promise<Response>]>([
    ["a network error", () => Promise.reject(new TypeError("fetch failed"))],
    ["a server error", () => Promise.resolve(json({ error: "down" }, 500))],
    ["a body that isn't JSON", () => Promise.resolve(new Response("<html>"))],
    ["JSON of the wrong kind", () => Promise.resolve(json(["a"]))],
  ])("%s means no data, not an error", async (_label, answer) => {
    const { get } = stub(
      new Map([
        [repoUrl("o/r"), () => Promise.resolve(json(PUBLIC))],
        [auditUrl("o/r", "a"), answer],
      ]),
    );

    const report = await auditSkills([github("a", "o/r")], { fetch: get, env: NO_ENV });

    expect(report.audits.size).toBe(0);
    expect(report.unaudited).toEqual(new Map([["a", "no-data"]]));
  });

  test("gives up on a slow answer after the timeout", async () => {
    const started = performance.now();

    const report = await auditSkills([github("a", "o/r")], {
      fetch: hang,
      env: NO_ENV,
      timeout: 50,
    });

    expect(report.unaudited).toEqual(new Map([["a", "not-public"]]));
    expect(performance.now() - started).toBeLessThan(1000);
  });

  test("an empty list asks nothing", async () => {
    const { get, requests } = stub(new Map());

    expect(await auditSkills([], { fetch: get, env: NO_ENV })).toEqual({
      audits: new Map(),
      unaudited: new Map(),
    });
    expect(requests).toEqual([]);
  });
});
