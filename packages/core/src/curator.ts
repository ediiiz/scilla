import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ScillaError } from "./errors.ts";
import {
  MANIFEST_FILE,
  normalizeReference,
  parseReferenceEntry,
  readManifest,
  referenceKey,
  shortenReference,
  writeManifest,
  type Manifest,
  type ReferenceEntry,
} from "./manifest.ts";

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Write a new `scilla.json` in `dir`; returns its path. Fails if `dir` is already a Collection.
 * `$schema`, when given, is written first so editors pick it up.
 */
export const initCollection = async (
  dir: string,
  info: Pick<Manifest, "$schema" | "name" | "description">,
) => {
  const file = join(dir, MANIFEST_FILE);

  if (existsSync(file)) {
    throw new ScillaError(`${file} already exists.`);
  }

  await mkdir(dir, { recursive: true });
  await writeManifest(dir, {
    $schema: info.$schema,
    name: info.name,
    description: info.description,
    references: [],
  });

  return file;
};

/** The manifest of the Collection in `dir`; fails when `dir` isn't one. */
export const requireManifest = async (dir: string): Promise<Manifest> => {
  const manifest = await readManifest(dir);

  if (manifest === undefined) {
    throw new ScillaError(
      `${dir} is not a Collection (no ${MANIFEST_FILE}); run \`scilla init\` first.`,
    );
  }

  return manifest;
};

/**
 * Append a Reference (string shorthand or object form) to the Collection in `dir`; returns its
 * parsed source. The source must parse, and a local one must exist; an entry equal to an existing
 * one (the string form equals `{ source }`) is refused. A github.com page link is stored as its
 * shorthand.
 */
export const addReference = async (dir: string, entry: ReferenceEntry) => {
  const manifest = await requireManifest(dir);
  const parsed = shortenReference(parseReferenceEntry(entry));
  const { source } = normalizeReference(parsed, dir);
  const local = join(source.url, source.path);

  if (source.kind === "local" && !existsSync(local)) {
    throw new ScillaError(`Local path ${local} does not exist.`);
  }

  const references = manifest.references ?? [];
  const key = referenceKey(parsed);

  if (references.some((existing) => referenceKey(existing) === key)) {
    throw new ScillaError(`The Collection already has this Reference.`);
  }

  await writeManifest(dir, { ...manifest, references: [...references, parsed] });

  return source;
};

const skillTemplate = (name: string) => `---
name: ${name}
description: TODO say what this skill does and when an agent should use it.
---

# ${name}
`;

/** Scaffold `skills/<name>/SKILL.md` in `dir`; returns the file's path. */
export const newOwnSkill = async (dir: string, name: string) => {
  if (!SKILL_NAME.test(name)) {
    throw new ScillaError(
      `Skill name "${name}" must be lowercase letters, digits and single hyphens.`,
    );
  }

  const skillDir = join(dir, "skills", name);

  if (existsSync(skillDir)) {
    throw new ScillaError(`${skillDir} already exists.`);
  }

  const file = join(skillDir, "SKILL.md");

  await mkdir(skillDir, { recursive: true });
  await writeFile(file, skillTemplate(name));

  return file;
};
