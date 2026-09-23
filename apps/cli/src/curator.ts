import { basename, resolve } from "node:path";
import {
  addReference,
  executablesSummary,
  Fetcher,
  initCollection,
  newOwnSkill,
  probeSource,
  readManifest,
  ScillaError,
  traverse,
  type Manifest,
  type ResolvedSkill,
  type Source,
  type Traversal,
} from "@scilla/core";
import type { RefAddCommand } from "./args.ts";
import type { Io } from "./io.ts";
import { Reporter, shortCommit } from "./report.ts";
import { SCHEMA_URL } from "./schema.ts";

/** `scilla init`: the name defaults to the directory's name; the manifest needs a description. */
export const init = async (io: Io, name: string | undefined, description: string | undefined) => {
  const collection = name ?? basename(io.cwd);

  const info: Pick<Manifest, "$schema" | "name" | "description"> = {
    $schema: SCHEMA_URL,
    name: collection,
    description:
      description === undefined || description.trim() === ""
        ? `The ${collection} Collection of agent skills.`
        : description,
  };

  const file = await initCollection(io.cwd, info);

  new Reporter(io).line(`Created ${file}`);
};

const referenceEntry = (command: RefAddCommand) => {
  const { source, include, exclude } = command;

  if (!command.optional && include.length === 0 && exclude.length === 0) {
    return source;
  }

  return {
    source,
    include: include.length === 0 ? undefined : [...include],
    exclude: exclude.length === 0 ? undefined : [...exclude],
    optional: command.optional ? true : undefined,
  };
};

/**
 * `scilla ref add <source>`: append a Reference to the Collection in the cwd. A git source that
 * doesn't answer only warns: it may be offline, or private with no credentials on this machine.
 */
export const refAdd = async (io: Io, command: RefAddCommand) => {
  const reporter = new Reporter(io);
  const source = await addReference(io.cwd, referenceEntry(command));
  const problem = command.verify ? await probeSource(source) : undefined;

  if (problem !== undefined) {
    reporter.warn(`${problem} Added it anyway; pass --no-verify to skip this check.`);
  }

  reporter.line(`Added Reference ${command.source}`);
};

/** `scilla skill new <name>`: scaffold an Own Skill. */
export const skillNew = async (io: Io, name: string) => {
  const file = await newOwnSkill(io.cwd, name);

  new Reporter(io).line(`Created ${file}`);
};

const OWN_SKILLS = "Own Skills";

const origin = (skill: ResolvedSkill) =>
  `${skill.url}${skill.path === "" ? "" : `/${skill.path}`}@${shortCommit(skill.commit)}`;

const skillLine = (skill: ResolvedSkill) => {
  const nested = skill.via.length > 1 ? ` via ${skill.via.slice(1).join(" > ")}` : "";
  const optional = skill.optional ? " (optional)" : "";

  const executables =
    skill.executables.length === 0
      ? ""
      : ` (executables: ${executablesSummary(skill.executables).join(", ")})`;

  return `  ${skill.name}  ${origin(skill)}${nested}${optional}${executables}`;
};

const printTree = (reporter: Reporter, traversal: Traversal, fetcher: Fetcher) => {
  const groups = Map.groupBy(traversal.skills, (skill) => skill.via[0] ?? OWN_SKILLS);

  reporter.line(`Collection "${traversal.name}": ${traversal.description}`);

  for (const [group, skills] of groups) {
    reporter.line(group);

    for (const skill of skills) {
      reporter.line(skillLine(skill));
    }
  }

  reporter.line(`${traversal.skills.length} skill(s)`);
  reporter.warnAll(traversal.warnings, fetcher.details);
};

/** `scilla check [dir]`: traverse a local Collection and print its skills grouped by where they came from. */
export const check = async (io: Io, dir: string | undefined) => {
  const target = resolve(io.cwd, dir ?? ".");
  const manifest = await readManifest(target);

  if (manifest === undefined) {
    throw new ScillaError(`${target} is not a Collection (no scilla.json).`);
  }

  const source: Source = { kind: "local", url: target, path: "", ref: undefined, skill: undefined };

  const fetcher = new Fetcher(io.cacheDir);

  const traversal = await io.tui.withProgress(
    `Checking ${manifest.name}`,
    () => traverse(source, fetcher, { home: io.home }),
    io.stderr,
  );

  printTree(new Reporter(io), traversal, fetcher);
};
