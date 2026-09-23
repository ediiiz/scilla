import { existsSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { discoverSkills, isSkillDir, readSkill, type FoundSkill } from "./discovery.ts";
import { ManifestError, ScillaError } from "./errors.ts";
import type { Checkout, Fetcher } from "./fetch.ts";
import {
  MANIFEST_FILE,
  normalizeReference,
  readManifest,
  referenceLabel,
  type Manifest,
  type Reference,
  type ReferenceEntry,
} from "./manifest.ts";
import { formatSource, type Source, type SourceKind } from "./source.ts";

/** One installable skill produced by Traversal, with its origin. */
export interface ResolvedSkill {
  readonly name: string;
  readonly description: string;
  readonly kind: SourceKind;
  /** Repo URL, or the directory of a local source. */
  readonly url: string;
  /** Skill folder relative to the repo root. */
  readonly path: string;
  readonly commit: string;
  /** Folder on disk to install from. */
  readonly dir: string;
  readonly optional: boolean;
  readonly executables: readonly string[];
  /** Reference labels from the root Collection down to this skill; empty for the root's Own Skills. */
  readonly via: readonly string[];
}

export interface Traversal {
  readonly name: string;
  readonly description: string;
  readonly source: Source;
  readonly commit: string;
  readonly skills: readonly ResolvedSkill[];
  readonly warnings: readonly string[];
}

/** A skill while Traversal is still combining; `nested` marks one that arrived through a Nested Collection. */
interface Candidate {
  readonly skill: ResolvedSkill;
  readonly nested: boolean;
}

interface Visit {
  readonly manifest: Manifest | undefined;
  readonly commit: string;
  readonly candidates: readonly Candidate[];
}

const MAX_NESTING = 8;

const matchesAny = (name: string, globs: readonly string[]) =>
  globs.some((glob) => new Bun.Glob(glob).match(name));

// A local skill can be reached through its own folder or a parent's, so its folder is its identity.
const identity = (skill: ResolvedSkill) =>
  skill.kind === "local" ? skill.dir : `${skill.url}\0${skill.path}\0${skill.commit}`;

const origin = (skill: ResolvedSkill) =>
  `${skill.url}${skill.path === "" ? "" : `/${skill.path}`}@${skill.commit.slice(0, 7)}`;

const resolved = (found: FoundSkill, source: Source, checkout: Checkout): ResolvedSkill => ({
  name: found.name,
  description: found.description,
  kind: source.kind,
  url: source.url,
  path: found.path,
  commit: checkout.commit,
  dir: found.dir,
  optional: false,
  executables: found.executables,
  via: [],
});

/** Apply a Reference's filters and marks; `label` heads each skill's `via` chain. */
const filterReference = (candidates: readonly Candidate[], reference: Reference, label: string) =>
  candidates.flatMap((candidate) => {
    const { name } = candidate.skill;
    const included = reference.include.length === 0 || matchesAny(name, reference.include);

    if (!included || matchesAny(name, reference.exclude)) {
      return [];
    }

    const skill = {
      ...candidate.skill,
      optional: candidate.skill.optional || reference.optional,
      via: [label, ...candidate.skill.via],
    };

    return [{ skill, nested: candidate.nested }];
  });

const markOptional = (candidate: Candidate, globs: readonly string[]): Candidate =>
  matchesAny(candidate.skill.name, globs)
    ? { nested: candidate.nested, skill: { ...candidate.skill, optional: true } }
    : candidate;

const markNested = (candidate: Candidate): Candidate => ({ skill: candidate.skill, nested: true });

/**
 * A local path inside a fetched Collection means a folder of that same repo at the same commit.
 * Paths that leave the repo (absolute, `~`, `..`) are refused so a remote Collection can't read the
 * Consumer's disk.
 */
const scopeLocal = (reference: Reference, parent: Source, checkout: Checkout): Reference => {
  if (parent.kind === "local" || reference.source.kind !== "local") {
    return reference;
  }

  const path = relative(checkout.root, reference.source.url);

  if (path.startsWith("..") || isAbsolute(path)) {
    throw new ScillaError(`local paths in a fetched Collection must stay inside its repo.`);
  }

  const source = { ...parent, path, ref: checkout.commit, skill: reference.source.skill };

  return { ...reference, source };
};

/** Where a Collection's References and Own Skills resolve from, and where its warnings go. */
interface Place {
  readonly target: string;
  readonly source: Source;
  readonly checkout: Checkout;
  /** Warnings in manifest order; References fetch in parallel, so each gets its own log. */
  readonly log: string[];
}

/** Dedupe diamonds and resolve same-name collisions within one Collection's output. */
const combine = (candidates: readonly Candidate[], collection: string, log: string[]) => {
  const byName = new Map<string, Candidate>();

  for (const candidate of candidates) {
    const existing = byName.get(candidate.skill.name);

    if (existing === undefined) {
      byName.set(candidate.skill.name, candidate);
      continue;
    }

    if (identity(existing.skill) === identity(candidate.skill)) {
      const optional = existing.skill.optional && candidate.skill.optional;

      byName.set(candidate.skill.name, { ...existing, skill: { ...existing.skill, optional } });
      continue;
    }

    const clash = `"${candidate.skill.name}" comes from both ${origin(existing.skill)} and ${origin(candidate.skill)}`;

    if (!existing.nested && !candidate.nested) {
      throw new ManifestError(`Collection "${collection}": skill ${clash}. Exclude one of them.`);
    }

    log.push(`Collection "${collection}": skill ${clash}; keeping the first.`);
  }

  return [...byName.values()];
};

const select = (candidates: readonly Candidate[], source: Source, log: string[]) => {
  if (source.skill === undefined) {
    return candidates;
  }

  const selected = candidates.filter((candidate) => candidate.skill.name === source.skill);

  if (selected.length === 0) {
    log.push(`No skill named "${source.skill}" in ${formatSource(source)}.`);
  }

  return selected;
};

const plain = async ({ target, source, checkout }: Place) => {
  const found = isSkillDir(target)
    ? [await readSkill(target, checkout.root)]
    : await discoverSkills(target, checkout.root);

  return found.map((skill) => ({ skill: resolved(skill, source, checkout), nested: false }));
};

export interface TraverseOptions {
  /** What `~` in a local Reference expands to; defaults to the OS home directory. */
  readonly home?: string;
}

class Walker {
  readonly #fetcher: Fetcher;

  readonly #home: string | undefined;

  constructor(fetcher: Fetcher, home: string | undefined) {
    this.#fetcher = fetcher;
    this.#home = home;
  }

  async visit(source: Source, stack: readonly string[], log: string[]): Promise<Visit> {
    const checkout = await this.#fetcher.checkout(source);
    const target = join(checkout.root, source.path);

    if (!existsSync(target)) {
      throw new ScillaError(`Path "${source.path}" not found in ${source.url}.`);
    }

    // A fetched Collection's checkout lives in the cache, so errors name its source instead.
    const label =
      source.kind === "local"
        ? undefined
        : `${MANIFEST_FILE} of ${formatSource(source)} at ${checkout.commit.slice(0, 7)}`;

    const manifest = await readManifest(target, label);
    const place = { target, source, checkout, log };

    const candidates =
      manifest === undefined ? await plain(place) : await this.#collection(manifest, place, stack);

    return { manifest, commit: checkout.commit, candidates: select(candidates, source, log) };
  }

  async #collection(manifest: Manifest, place: Place, stack: readonly string[]) {
    const { source, log } = place;
    const key = `${source.url}//${source.path}`;

    if (stack.includes(key)) {
      log.push(`Skipped a cycle back to Collection "${manifest.name}" (${formatSource(source)}).`);

      return [];
    }

    if (stack.length > MAX_NESTING) {
      log.push(`Skipped "${manifest.name}": Collections nest deeper than ${MAX_NESTING}.`);

      return [];
    }

    const own = (await plain(place)).filter(
      (candidate) => !matchesAny(candidate.skill.name, manifest.exclude ?? []),
    );

    const referenced = await Promise.all(
      (manifest.references ?? []).map((entry) => this.#reference(entry, place, [...stack, key])),
    );

    for (const reference of referenced) {
      log.push(...reference.log);
    }

    const optional = manifest.optional ?? [];

    const marked = [...own, ...referenced.flatMap((reference) => reference.candidates)].map(
      (candidate) => markOptional(candidate, optional),
    );

    return combine(marked, manifest.name, log);
  }

  async #reference(entry: ReferenceEntry, place: Place, stack: readonly string[]) {
    const log: string[] = [];

    try {
      const reference = scopeLocal(
        normalizeReference(entry, place.target, this.#home),
        place.source,
        place.checkout,
      );

      const visit = await this.visit(reference.source, stack, log);

      const candidates =
        visit.manifest === undefined
          ? filterReference(visit.candidates, reference, reference.label)
          : filterReference(visit.candidates.map(markNested), reference, visit.manifest.name);

      return { candidates, log };
    } catch (cause) {
      if (cause instanceof ScillaError && !(cause instanceof ManifestError)) {
        const warning = `Reference "${referenceLabel(entry)}" skipped: ${cause.message}`;

        log.push(warning);
        this.#fetcher.explain(warning, cause.detail);

        return { candidates: [], log };
      }

      throw cause;
    }
  }
}

/**
 * Follow References outward from `source` and return the full set of installable skills. A shared
 * `fetcher` reports each warning once: only warnings raised during this Traversal are included.
 */
export const traverse = async (
  source: Source,
  fetcher: Fetcher,
  { home }: TraverseOptions = {},
): Promise<Traversal> => {
  const log: string[] = [];
  const earlier = fetcher.warnings.length;
  const root = await new Walker(fetcher, home).visit(source, [], log);

  return {
    name: root.manifest?.name ?? formatSource(source),
    description: root.manifest?.description ?? "",
    source,
    commit: root.commit,
    skills: root.candidates.map((candidate) => candidate.skill),
    warnings: [...fetcher.warnings.slice(earlier), ...log],
  };
};
