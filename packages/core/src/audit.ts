import { z } from "zod";
import { githubRepo } from "./source.ts";
import type { ResolvedSkill } from "./traversal.ts";

/** Security risk ratings, from harmless to dangerous, as the audit service reports them. */
const RISKS = ["safe", "low", "medium", "high", "critical"] as const;

export type Risk = (typeof RISKS)[number];

/** One provider's rating of one skill. */
export interface ProviderRating {
  /** The service's provider key, such as `ath` or `socket`. */
  readonly id: string;
  /** Display name: Gen, Socket, Snyk, ZeroLeaks, or the id for providers scilla doesn't know. */
  readonly label: string;
  readonly risk: Risk;
  readonly alerts?: number | undefined;
  readonly score?: number | undefined;
}

/** A skill's security ratings. Skills without any are absent: that means "not audited", never "safe". */
export interface SkillAudit {
  /** Known providers first (Gen, Socket, Snyk, ZeroLeaks), then others by id. */
  readonly providers: readonly ProviderRating[];
  /** The highest risk any provider reports. */
  readonly worst: Risk | undefined;
  /** Where people can read the full assessment (`https://skills.sh/<owner/repo>`). */
  readonly detailsUrl: string;
}

/**
 * Why a skill has no audit:
 * - `disabled`: opted out (`enabled: false`, `DO_NOT_TRACK`, `DISABLE_TELEMETRY`, `SCILLA_NO_AUDIT`)
 * - `not-github`: not from a GitHub repo (another git host or a local folder); its name is never sent
 * - `not-public`: GitHub didn't confirm the repo is public; its name is never sent
 * - `no-data`: the audit service has no ratings for it, or didn't answer in time
 */
export type Unaudited = "disabled" | "not-github" | "not-public" | "no-data";

/** Why a skill has no audit, in words for people: `scilla audit` and the picker show these. */
export const UNAUDITED_REASONS: Readonly<Record<Unaudited, string>> = {
  disabled: "ratings are turned off",
  "not-github": "not from GitHub",
  "not-public": "not a public GitHub repo",
  "no-data": "no ratings yet",
};

export interface AuditReport {
  readonly audits: ReadonlyMap<string, SkillAudit>;
  readonly unaudited: ReadonlyMap<string, Unaudited>;
}

/** What the audit needs to know about a skill: a Traversal's `ResolvedSkill`, or a lock entry. */
export type AuditTarget = Pick<ResolvedSkill, "name" | "kind" | "url">;

/** The subset of `fetch` the audit uses; tests pass a stub so nothing reaches the network. */
export type AuditFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface AuditOptions {
  /** False skips the audit (`--no-audit`). */
  readonly enabled?: boolean;
  readonly fetch?: AuditFetch;
  /** Where the opt-out variables are read; `process.env` by default. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Per-request timeout in ms; 3 s by default. */
  readonly timeout?: number;
}

const AUDIT_URL = "https://add-skill.vercel.sh/audit";

const GITHUB_API = "https://api.github.com/repos";

const DETAILS_URL = "https://skills.sh";

const TIMEOUT_MS = 3000;

const OPT_OUT = ["DO_NOT_TRACK", "DISABLE_TELEMETRY", "SCILLA_NO_AUDIT"];

/** Known providers, in display order. */
const LABELS: ReadonlyMap<string, string> = new Map([
  ["ath", "Gen"],
  ["socket", "Socket"],
  ["snyk", "Snyk"],
  ["zeroleaks", "ZeroLeaks"],
]);

const ORDER = [...LABELS.keys()];

// Only `private: false` counts as public; errors, rate limits and missing repos all mean "don't send".
const PublicRepoSchema = z.object({ private: z.literal(false) });

// Lenient: an unknown provider passes through, and a provider entry that doesn't parse is dropped.
const RatingSchema = z
  .object({
    risk: z.enum(RISKS),
    alerts: z.number().optional().catch(undefined),
    score: z.number().optional().catch(undefined),
  })
  .nullable()
  .catch(null);

const AuditResponseSchema = z.record(z.string(), z.record(z.string(), RatingSchema).catch({}));

type SkillRatings = z.infer<typeof AuditResponseSchema>[string];

interface Client {
  readonly get: AuditFetch;
  readonly timeout: number;
}

/** GET `url` and parse its JSON with `schema`; undefined on any failure, including a timeout. */
const getJson = async <T>(client: Client, url: string, schema: z.ZodType<T>) => {
  try {
    const response = await client.get(url, {
      signal: AbortSignal.timeout(client.timeout),
      headers: { accept: "application/json" },
    });

    if (response.status !== 200) {
      return undefined;
    }

    const parsed = schema.safeParse(await response.json());

    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};

const rank = (risk: Risk) => RISKS.indexOf(risk);

const providerOrder = (id: string) => {
  const index = ORDER.indexOf(id);

  return index === -1 ? ORDER.length : index;
};

const byProvider = (a: ProviderRating, b: ProviderRating) =>
  providerOrder(a.id) - providerOrder(b.id) || a.id.localeCompare(b.id);

const worstOf = (providers: readonly ProviderRating[]) =>
  providers.reduce<Risk | undefined>(
    (worst, { risk }) => (worst === undefined || rank(risk) > rank(worst) ? risk : worst),
    undefined,
  );

const toAudit = (ratings: SkillRatings | undefined, detailsUrl: string) => {
  const providers = Object.entries(ratings ?? {})
    .flatMap(([id, rating]) =>
      rating === null
        ? []
        : [
            {
              id,
              label: LABELS.get(id) ?? id,
              risk: rating.risk,
              alerts: rating.alerts,
              score: rating.score,
            },
          ],
    )
    .toSorted(byProvider);

  if (providers.length === 0) {
    return undefined;
  }

  const audit: SkillAudit = { providers, worst: worstOf(providers), detailsUrl };

  return audit;
};

interface RepoResult {
  readonly names: readonly string[];
  readonly public: boolean;
  readonly audits: ReadonlyMap<string, SkillAudit>;
}

/** Confirm `repo` is public, then ask the audit service about `names`, all within one repo. */
const auditRepo = async (client: Client, repo: string, names: readonly string[]) => {
  const visible = await getJson(client, `${GITHUB_API}/${repo}`, PublicRepoSchema);

  if (visible === undefined) {
    return { names, public: false, audits: new Map() } satisfies RepoResult;
  }

  const query = new URLSearchParams({ source: repo, skills: names.join(",") });
  const response = await getJson(client, `${AUDIT_URL}?${query}`, AuditResponseSchema);
  const audits = new Map<string, SkillAudit>();

  for (const name of names) {
    const audit = toAudit(response?.[name], `${DETAILS_URL}/${repo}`);

    if (audit !== undefined) {
      audits.set(name, audit);
    }
  }

  return { names, public: true, audits } satisfies RepoResult;
};

const optedOut = (env: Readonly<Record<string, string | undefined>>) =>
  OPT_OUT.some((name) => (env[name] ?? "") !== "");

/** The skills' `owner/repo`s, and the names of skills that aren't from GitHub. */
const groupByRepo = (skills: readonly AuditTarget[]) => {
  const repos = new Map<string, string[]>();
  const elsewhere: string[] = [];

  for (const skill of skills) {
    const repo = skill.kind === "github" ? githubRepo(skill.url) : undefined;

    if (repo === undefined) {
      elsewhere.push(skill.name);
    } else {
      repos.set(repo, [...(repos.get(repo) ?? []), skill.name]);
    }
  }

  return { repos, elsewhere };
};

/**
 * Fetch security ratings for skills from public GitHub repos, one request per repo, in parallel.
 * A repo's name is sent only after GitHub confirms it is public, and nothing is sent when the
 * audit is disabled. Failures and timeouts are never errors: those skills are just unaudited.
 */
export const auditSkills = async (
  skills: readonly AuditTarget[],
  {
    enabled = true,
    fetch: get = fetch,
    env = process.env,
    timeout = TIMEOUT_MS,
  }: AuditOptions = {},
): Promise<AuditReport> => {
  if (!enabled || optedOut(env)) {
    const unaudited = new Map(skills.map((skill) => [skill.name, "disabled" as const]));

    return { audits: new Map(), unaudited };
  }

  const { repos, elsewhere } = groupByRepo(skills);
  const client = { get, timeout };

  const results = await Promise.all(
    [...repos].map(([repo, names]) => auditRepo(client, repo, names)),
  );

  const audits = new Map<string, SkillAudit>();
  const unaudited = new Map<string, Unaudited>(elsewhere.map((name) => [name, "not-github"]));

  for (const result of results) {
    for (const name of result.names) {
      const audit = result.audits.get(name);

      if (audit === undefined) {
        unaudited.set(name, result.public ? "no-data" : "not-public");
      } else {
        audits.set(name, audit);
      }
    }
  }

  return { audits, unaudited };
};
