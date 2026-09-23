import { z } from "zod";
import type { AuditFetch } from "./audit.ts";
import { envValue } from "./env.ts";
import { ScillaError } from "./errors.ts";

/** The git hosts `scilla review propose --open` can open a pull (or merge) request on. */
export const PROVIDERS = ["github", "gitea", "forgejo", "gitlab"] as const;

export type Provider = (typeof PROVIDERS)[number];

/** A git remote's web origin (`https://host[:port]`) and the path segments of the repo on it. */
export interface Remote {
  readonly origin: string;
  readonly host: string;
  readonly segments: readonly string[];
}

const SCP_LIKE = /^(?:[^@/]+@)?([^:/]+):(?!\/)(.+)$/;

const segmentsOf = (path: string) =>
  path
    .replace(/\.git\/?$/, "")
    .split("/")
    .filter((segment) => segment !== "");

const parseUrl = (url: string) => {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
};

/** Read a remote URL: https, http, ssh, or scp-like `git@host:owner/repo.git`. */
export const parseRemote = (url: string): Remote => {
  const parsed = parseUrl(url);

  if (parsed !== undefined && ["https:", "http:", "ssh:"].includes(parsed.protocol)) {
    const scheme = parsed.protocol === "http:" ? "http:" : "https:";
    // An ssh remote's port is its ssh port, not the web server's.
    const host = parsed.protocol === "ssh:" ? parsed.hostname : parsed.host;

    return {
      origin: `${scheme}//${host}`,
      host: parsed.hostname,
      segments: segmentsOf(parsed.pathname),
    };
  }

  const [, host, path] = SCP_LIKE.exec(url) ?? [];

  if (host === undefined || path === undefined) {
    throw new ScillaError(`Can't read the remote URL "${url}".`);
  }

  return { origin: `https://${host}`, host, segments: segmentsOf(path) };
};

/** Hosts whose kind is known by name. */
const KNOWN_HOSTS: ReadonlyMap<string, Provider> = new Map([
  ["github.com", "github"],
  ["gitlab.com", "gitlab"],
  ["codeberg.org", "forgejo"],
  ["gitea.com", "gitea"],
]);

/** Tokens each provider reads, in order of preference. */
const TOKENS: Readonly<Record<Provider, readonly string[]>> = {
  github: ["GITHUB_TOKEN"],
  gitea: ["GITEA_TOKEN", "FORGEJO_TOKEN"],
  forgejo: ["FORGEJO_TOKEN", "GITEA_TOKEN"],
  gitlab: ["GITLAB_TOKEN", "CI_JOB_TOKEN"],
};

/**
 * Which forge hosts a remote: `explicit` (`--provider`) first, then a known host name, then the
 * one token variable that is set. Undefined when there's no telling.
 */
export const detectProvider = (
  remote: Remote,
  explicit: Provider | undefined,
  env: Readonly<Record<string, string | undefined>>,
) => {
  if (explicit !== undefined) {
    return explicit;
  }

  const known = KNOWN_HOSTS.get(remote.host);

  if (known !== undefined) {
    return known;
  }

  if (remote.host.includes("gitlab")) {
    return "gitlab";
  }

  const byToken = (["forgejo", "gitea", "gitlab"] as const).filter(
    (provider) => envValue(env, TOKENS[provider][0] ?? "") !== undefined,
  );

  return byToken.length === 1 ? byToken[0] : undefined;
};

/** A pull request to open, or to update when one is already open for its branch. */
export interface PullRequest {
  readonly title: string;
  readonly body: string;
  readonly head: string;
  readonly base: string;
}

export interface Opened {
  readonly url: string;
  readonly number: number;
  /** An open pull request for the branch existed, and its title and body were replaced. */
  readonly updated: boolean;
}

interface Client {
  readonly fetch: AuditFetch;
  readonly headers: Readonly<Record<string, string>>;
  readonly provider: Provider;
}

const call = async <T>(
  client: Client,
  method: string,
  url: string,
  schema: z.ZodType<T>,
  body?: Readonly<Record<string, string>>,
): Promise<T> => {
  const response = await client.fetch(url, {
    method,
    headers: { accept: "application/json", "content-type": "application/json", ...client.headers },
    body: body === undefined ? null : JSON.stringify(body),
  });

  if (!response.ok) {
    const text = (await response.text()).slice(0, 300);

    throw new ScillaError(
      `${client.provider} answered ${method} ${url} with ${response.status}: ${text}`,
    );
  }

  const parsed = schema.safeParse(await response.json());

  if (!parsed.success) {
    throw new ScillaError(`${client.provider} sent an unexpected answer to ${method} ${url}.`);
  }

  return parsed.data;
};

const PullSchema = z.object({ number: z.number(), html_url: z.string() });

const OpenPullsSchema = z.array(PullSchema.extend({ head: z.object({ ref: z.string() }) }));

const MergeRequestSchema = z.object({ iid: z.number(), web_url: z.string() });

/** GitHub, Gitea and Forgejo share one pulls API; only the URLs, auth and listing differ. */
const openPull = async (client: Client, repo: string, list: string, request: PullRequest) => {
  const open = await call(client, "GET", list, OpenPullsSchema);
  const existing = open.find((pull) => pull.head.ref === request.head);
  const content = { title: request.title, body: request.body };

  if (existing !== undefined) {
    const pull = await call(
      client,
      "PATCH",
      `${repo}/pulls/${existing.number}`,
      PullSchema,
      content,
    );

    return { url: pull.html_url, number: pull.number, updated: true };
  }

  const pull = await call(client, "POST", `${repo}/pulls`, PullSchema, {
    ...content,
    head: request.head,
    base: request.base,
  });

  return { url: pull.html_url, number: pull.number, updated: false };
};

const openMergeRequest = async (client: Client, project: string, request: PullRequest) => {
  const query = new URLSearchParams({ state: "opened", source_branch: request.head });

  const open = await call(
    client,
    "GET",
    `${project}/merge_requests?${query}`,
    z.array(MergeRequestSchema),
  );

  const existing = open[0];
  const content = { title: request.title, description: request.body };

  if (existing !== undefined) {
    const merge = await call(
      client,
      "PUT",
      `${project}/merge_requests/${existing.iid}`,
      MergeRequestSchema,
      content,
    );

    return { url: merge.web_url, number: merge.iid, updated: true };
  }

  const merge = await call(client, "POST", `${project}/merge_requests`, MergeRequestSchema, {
    ...content,
    source_branch: request.head,
    target_branch: request.base,
  });

  return { url: merge.web_url, number: merge.iid, updated: false };
};

const tokenFor = (provider: Provider, env: Readonly<Record<string, string | undefined>>) => {
  const found = TOKENS[provider].find((name) => envValue(env, name) !== undefined);

  if (found === undefined) {
    throw new ScillaError(
      `Set ${TOKENS[provider].join(" or ")} to open a pull request on ${provider}.`,
    );
  }

  return { name: found, value: envValue(env, found) ?? "" };
};

const ownerAndRepo = (remote: Remote) => {
  const owner = remote.segments.at(-2);
  const repo = remote.segments.at(-1);

  if (owner === undefined || repo === undefined) {
    throw new ScillaError(
      `Can't find the owner and repo in ${remote.origin}/${remote.segments.join("/")}.`,
    );
  }

  return { owner: encodeURIComponent(owner), repo: encodeURIComponent(repo) };
};

const githubApi = (remote: Remote, env: Readonly<Record<string, string | undefined>>) =>
  envValue(env, "GITHUB_API_URL") ??
  (remote.host === "github.com" ? "https://api.github.com" : `${remote.origin}/api/v3`);

export interface OpenOptions {
  readonly fetch: AuditFetch;
  readonly env: Readonly<Record<string, string | undefined>>;
}

/**
 * Open a pull request (a merge request on GitLab) for `request.head`, or update the title and body
 * of the one already open for it, through the provider's REST API.
 */
export const openPullRequest = async (
  provider: Provider,
  remote: Remote,
  request: PullRequest,
  { fetch, env }: OpenOptions,
): Promise<Opened> => {
  const token = tokenFor(provider, env);

  if (provider === "gitlab") {
    const header = token.name === "CI_JOB_TOKEN" ? "job-token" : "private-token";
    const client = { fetch, provider, headers: { [header]: token.value } };
    const project = `${remote.origin}/api/v4/projects/${encodeURIComponent(remote.segments.join("/"))}`;

    return openMergeRequest(client, project, request);
  }

  const { owner, repo } = ownerAndRepo(remote);

  if (provider === "github") {
    const client = {
      fetch,
      provider,
      headers: {
        authorization: `Bearer ${token.value}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
    };

    const base = `${githubApi(remote, env)}/repos/${owner}/${repo}`;
    const query = new URLSearchParams({ state: "open", head: `${owner}:${request.head}` });

    return openPull(client, base, `${base}/pulls?${query}`, request);
  }

  // Gitea and Forgejo may be served under a path: everything before owner/repo.
  const prefix = remote.segments
    .slice(0, -2)
    .map((segment) => `/${segment}`)
    .join("");

  const base = `${remote.origin}${prefix}/api/v1/repos/${owner}/${repo}`;
  const client = { fetch, provider, headers: { authorization: `token ${token.value}` } };

  return openPull(client, base, `${base}/pulls?state=open&limit=50`, request);
};
