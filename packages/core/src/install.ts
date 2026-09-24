import { existsSync } from "node:fs";
import { cp, lstat, mkdir, rm, symlink } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { hashIfPresent } from "./hash.ts";
import { skillsDir, type AgentLinks, type Scope } from "./lock.ts";

const SKIPPED = new Set([".git", "node_modules"]);

/** An agent that reads skills from `<folder>/skills`, where scilla can link each installed one. */
export interface Agent {
  /** Its folder in the project or home, which keys its answer in the lock's `agentLinks`. */
  readonly folder: string;
  /** What the picker calls it. */
  readonly name: string;
}

/** The agents scilla links skills into; one more is one more entry here. */
const AGENTS: readonly Agent[] = [{ folder: ".claude", name: "Claude Code" }];

const hasFolder = (scope: Scope, agent: Agent) => existsSync(join(scope.base, agent.folder));

const linksDir = (scope: Scope, agent: Agent) => join(scope.base, agent.folder, "skills");

/** Where links go: agents the Consumer said yes to, and those without an answer whose folder exists. */
const linkDirs = (scope: Scope, links: AgentLinks | undefined) =>
  AGENTS.flatMap((agent) =>
    (links?.[agent.folder] ?? hasFolder(scope, agent)) ? [linksDir(scope, agent)] : [],
  );

/** Agents whose folder doesn't exist yet and whose answer isn't recorded: worth asking about. */
export const unansweredAgents = (scope: Scope, links: AgentLinks | undefined) =>
  AGENTS.filter((agent) => links?.[agent.folder] === undefined && !hasFolder(scope, agent));

/** Folders that hold links now, answered or not, so removing a skill takes its links too. */
const presentLinkDirs = (scope: Scope) =>
  AGENTS.flatMap((agent) => (hasFolder(scope, agent) ? [linksDir(scope, agent)] : []));

export const installedDir = (scope: Scope, name: string) => join(skillsDir(scope), name);

/** Hash of the installed copy, or undefined when it isn't on disk. */
export const installedHash = (scope: Scope, name: string) =>
  hashIfPresent(installedDir(scope, name));

const isLink = async (path: string) => {
  try {
    return (await lstat(path)).isSymbolicLink();
  } catch {
    return false;
  }
};

const link = async (dir: string, name: string, target: string) => {
  const path = join(dir, name);

  await mkdir(dir, { recursive: true });

  if (await isLink(path)) {
    await rm(path, { force: true });
  } else if (existsSync(path)) {
    return [`Left ${path} alone: it is a real folder, not a scilla link.`];
  }

  await symlink(relative(dir, target), path, "dir");

  return [];
};

/**
 * Link an installed skill into each agent folder `links` asks for (see `linkDirs`). Returns
 * warnings for agent folders that already hold a real skill of that name.
 */
export const linkSkill = async (scope: Scope, name: string, links: AgentLinks | undefined) => {
  const target = installedDir(scope, name);
  const warnings = await Promise.all(linkDirs(scope, links).map((dir) => link(dir, name, target)));

  return warnings.flat();
};

/** Copy a skill folder into `.agents/skills/<name>` and link it; see `linkSkill`. */
export const installSkillFiles = async (
  scope: Scope,
  name: string,
  from: string,
  links: AgentLinks | undefined,
) => {
  const target = installedDir(scope, name);

  await rm(target, { recursive: true, force: true });
  await mkdir(skillsDir(scope), { recursive: true });
  await cp(from, target, { recursive: true, filter: (path) => !SKIPPED.has(basename(path)) });

  return linkSkill(scope, name, links);
};

/** Remove an installed skill and any agent symlinks that point at it. */
export const removeSkillFiles = async (scope: Scope, name: string) => {
  await rm(installedDir(scope, name), { recursive: true, force: true });
  await Promise.all(
    presentLinkDirs(scope).map(async (dir) => {
      const path = join(dir, name);

      if (await isLink(path)) {
        await rm(path, { force: true });
      }
    }),
  );
};
