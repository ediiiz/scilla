import { existsSync } from "node:fs";
import { cp, lstat, mkdir, rm, symlink } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { hashIfPresent } from "./hash.ts";
import { skillsDir, type Scope } from "./lock.ts";

const SKIPPED = new Set([".git", "node_modules"]);

/** Agent folders that get a symlink to each installed skill, when the agent's folder already exists. */
const AGENT_DIRS = [".claude"];

const linkDirs = (scope: Scope) =>
  AGENT_DIRS.flatMap((agent) =>
    existsSync(join(scope.base, agent)) ? [join(scope.base, agent, "skills")] : [],
  );

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
 * Copy a skill folder into `.agents/skills/<name>` and link it into each present agent folder.
 * Returns warnings for agent folders that already hold a real skill of that name.
 */
export const installSkillFiles = async (scope: Scope, name: string, from: string) => {
  const target = installedDir(scope, name);

  await rm(target, { recursive: true, force: true });
  await mkdir(skillsDir(scope), { recursive: true });
  await cp(from, target, { recursive: true, filter: (path) => !SKIPPED.has(basename(path)) });

  const warnings = await Promise.all(linkDirs(scope).map((dir) => link(dir, name, target)));

  return warnings.flat();
};

/** Remove an installed skill and any agent symlinks that point at it. */
export const removeSkillFiles = async (scope: Scope, name: string) => {
  await rm(installedDir(scope, name), { recursive: true, force: true });
  await Promise.all(
    linkDirs(scope).map(async (dir) => {
      const path = join(dir, name);

      if (await isLink(path)) {
        await rm(path, { force: true });
      }
    }),
  );
};
