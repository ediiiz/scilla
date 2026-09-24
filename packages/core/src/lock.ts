import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { z } from "zod";
import { messageOf, ScillaError } from "./errors.ts";
import { formatSource, githubRepo, type Source } from "./source.ts";

/** Where skills get installed: the project (cwd) or the user's home (`--global`). */
export interface Scope {
  readonly base: string;
  readonly global: boolean;
}

export const skillsDir = (scope: Scope) => join(scope.base, ".agents", "skills");

const lockPath = (scope: Scope) =>
  scope.global
    ? join(scope.base, ".agents", "scilla-lock.json")
    : join(scope.base, "scilla-lock.json");

const LockSourceSchema = z.object({
  kind: z.enum(["github", "git", "local"]),
  url: z.string(),
  path: z.string(),
  ref: z.string().optional(),
  skill: z.string().optional(),
});

const CollectionEntrySchema = z.object({
  name: z.string(),
  source: LockSourceSchema,
  commit: z.string(),
  selected: z.array(z.string()),
  declined: z.array(z.string()),
});

const SkillEntrySchema = z.object({
  collections: z.array(z.string()),
  kind: z.enum(["github", "git", "local"]),
  url: z.string(),
  path: z.string(),
  commit: z.string(),
  computedHash: z.string(),
  optional: z.boolean(),
});

const LockSchema = z.object({
  version: z.literal(1),
  /**
   * Whether installed skills get linked into each agent folder (`.claude`), as the Consumer
   * answered. An agent without an answer is linked only when its folder already exists.
   */
  agentLinks: z.record(z.string(), z.boolean()).optional(),
  collections: z.record(z.string(), CollectionEntrySchema),
  skills: z.record(z.string(), SkillEntrySchema),
});

export type Lock = z.infer<typeof LockSchema>;

export type CollectionEntry = z.infer<typeof CollectionEntrySchema>;

export type SkillEntry = z.infer<typeof SkillEntrySchema>;

export type AgentLinks = NonNullable<Lock["agentLinks"]>;

export const toLockSource = (source: Source): CollectionEntry["source"] => ({
  kind: source.kind,
  url: source.url,
  path: source.path,
  ref: source.ref,
  skill: source.skill,
});

export const fromLockSource = (source: CollectionEntry["source"]): Source => ({
  kind: source.kind,
  url: source.url,
  path: source.path,
  ref: source.ref,
  skill: source.skill,
});

const sortKeys = <T>(record: Readonly<Record<string, T>>) =>
  Object.fromEntries(Object.entries(record).toSorted(([a], [b]) => a.localeCompare(b)));

const writeJson = async <T>(file: string, value: T) => {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
};

const parseJson = (text: string, file: string) => {
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new ScillaError(`${file} is not valid JSON: ${messageOf(cause)}`);
  }
};

const emptyLock = (): Lock => ({ version: 1, collections: {}, skills: {} });

interface Origin {
  readonly kind: CollectionEntry["source"]["kind"];
  readonly url: string;
}

/** A `git` origin that is really a github.com https URL, which older versions didn't read as GitHub. */
const isOldGithub = (origin: Origin) =>
  origin.kind === "git" && githubRepo(origin.url) !== undefined;

/** Old key to new key for each Collection added by its github.com https URL, unless the new key is taken. */
const renamedKeys = (lock: Lock) => {
  const renames = new Map<string, string>();

  for (const [key, entry] of Object.entries(lock.collections)) {
    const next = formatSource({ ...fromLockSource(entry.source), kind: "github" });

    if (isOldGithub(entry.source) && !(next in lock.collections)) {
      renames.set(key, next);
    }
  }

  return renames;
};

/**
 * Read a lock written before github.com https URLs counted as GitHub: those Collections are re-keyed
 * the way `formatSource` keys them now (`owner/repo`), and those skills become `github`, so they're
 * audited and mirrored to skills-lock.json as GitHub skills. The next write persists it.
 */
const migrateGithubUrls = (lock: Lock): Lock => {
  const renames = renamedKeys(lock);

  const collections = Object.entries(lock.collections).map(
    ([key, entry]): [string, CollectionEntry] => {
      const next = renames.get(key);

      return next === undefined
        ? [key, entry]
        : [next, { ...entry, source: { ...entry.source, kind: "github" } }];
    },
  );

  const skills = Object.entries(lock.skills).map(([name, entry]): [string, SkillEntry] => [
    name,
    {
      ...entry,
      kind: isOldGithub(entry) ? "github" : entry.kind,
      collections: entry.collections.map((key) => renames.get(key) ?? key),
    },
  ]);

  const migrated: Lock = {
    version: 1,
    collections: Object.fromEntries(collections),
    skills: Object.fromEntries(skills),
  };

  if (lock.agentLinks !== undefined) {
    migrated.agentLinks = lock.agentLinks;
  }

  return migrated;
};

export const readLock = async (scope: Scope): Promise<Lock> => {
  const file = lockPath(scope);

  if (!existsSync(file)) {
    return emptyLock();
  }

  const text = await readFile(file, "utf8");
  const parsed = LockSchema.safeParse(parseJson(text, file));

  if (!parsed.success) {
    throw new ScillaError(`${file} is invalid:\n${z.prettifyError(parsed.error)}`);
  }

  return migrateGithubUrls(parsed.data);
};

export const writeLock = async (scope: Scope, lock: Lock) => {
  const sorted: Lock = { version: 1, collections: {}, skills: {} };

  // Written in this key order, so the file reads the same after every write.
  if (lock.agentLinks !== undefined) {
    sorted.agentLinks = sortKeys(lock.agentLinks);
  }

  sorted.collections = sortKeys(lock.collections);
  sorted.skills = sortKeys(lock.skills);
  await writeJson(lockPath(scope), sorted);
};

// The skills CLI's project lock. Entries are kept loose so fields scilla doesn't know survive a rewrite.
const SkillsLockSchema = z.object({
  version: z.literal(1),
  skills: z.record(z.string(), z.looseObject({ source: z.string() })),
});

type SkillsLock = z.infer<typeof SkillsLockSchema>;

/** The current skills-lock.json, or undefined when it exists but can't be read safely. */
const readSkillsLock = async (file: string): Promise<SkillsLock | undefined> => {
  if (!existsSync(file)) {
    return { version: 1, skills: {} };
  }

  try {
    return SkillsLockSchema.parse(JSON.parse(await readFile(file, "utf8")));
  } catch {
    return undefined;
  }
};

/** The skill names the project's skills-lock.json lists; none when it's missing or unreadable. */
export const skillsLockNames = async (scope: Scope) => {
  const current = await readSkillsLock(join(scope.base, "skills-lock.json"));

  return Object.keys(current?.skills ?? {});
};

// No `ref` is written: scilla's Pins live on References, and the skills CLI would read one as its own.
const skillsLockEntry = (scope: Scope, entry: SkillEntry) => {
  const skillPath = entry.path === "" ? "SKILL.md" : `${entry.path}/SKILL.md`;
  const repo = githubRepo(entry.url);

  if (entry.kind === "github" && repo !== undefined) {
    return { source: repo, sourceType: "github", skillPath, computedHash: entry.computedHash };
  }

  if (entry.kind === "local") {
    const source = `./${relative(scope.base, entry.url)}`;

    return { source, sourceType: "local", skillPath, computedHash: entry.computedHash };
  }

  return {
    source: entry.url,
    sourceUrl: entry.url,
    sourceType: "git",
    skillPath,
    computedHash: entry.computedHash,
  };
};

/**
 * Mirror the project's installed skills into the skills CLI's `skills-lock.json` so that tool sees
 * them too. `removed` names are dropped. Global installs have no skills-lock.json, as in the skills CLI.
 * A lock that can't be parsed is left untouched (rewriting it would drop the skills CLI's entries);
 * the returned warnings say so.
 */
export const syncSkillsLock = async (scope: Scope, lock: Lock, removed: readonly string[]) => {
  if (scope.global) {
    return [];
  }

  const file = join(scope.base, "skills-lock.json");
  const current = await readSkillsLock(file);

  if (current === undefined) {
    return [`Left ${file} alone: it isn't a skills-lock.json scilla can read.`];
  }

  const skills = { ...current.skills };

  for (const name of removed) {
    delete skills[name];
  }

  for (const [name, entry] of Object.entries(lock.skills)) {
    skills[name] = { ...skills[name], ...skillsLockEntry(scope, entry) };
  }

  await writeJson(file, { version: 1, skills: sortKeys(skills) });

  return [];
};
