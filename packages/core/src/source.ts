import { homedir } from "node:os";
import { relative, resolve, sep } from "node:path";
import { SourceError } from "./errors.ts";

export type SourceKind = "github" | "git" | "local";

/** Where a Collection or Reference points: a repo (or local dir), narrowed to a path, a Pin and an optional skill name. */
export interface Source {
  readonly kind: SourceKind;
  /** Canonical git URL, or an absolute directory for local sources. */
  readonly url: string;
  /** Repo-relative path without leading or trailing slashes; "" is the root. */
  readonly path: string;
  readonly ref: string | undefined;
  /** The `@name` selector: only this skill is taken. */
  readonly skill: string | undefined;
}

/** `file` relative to the repo at `root`, with "/" on every OS, as a Source path and the lock use. */
export const repoPath = (root: string, file: string) => relative(root, file).split(sep).join("/");

const GITHUB_SHORTHAND = /^([\w.-]+)\/([\w.-]+)(?:\/(.+))?$/;

const GITHUB_URL = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/;

const SKILL_SELECTOR = /^(.*)@([\w.-]+)$/;

/** A github.com page: `/tree/<ref>[/<path>]` or `/blob/<ref>/<path>`, ignoring any `?query` or `#anchor`. */
const GITHUB_PAGE =
  /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(tree|blob)\/([^/?#]+)([^?#]*)(?:[?#].*)?$/;

/** Default-branch names a page link floats with instead of pinning. */
const FLOATING_BRANCHES = new Set(["main", "master"]);

const SKILL_FILE = "SKILL.md";

const trimSlashes = (path: string) => path.replace(/^\/+|\/+$/g, "");

const isLocal = (spec: string) =>
  spec === "." || spec === ".." || spec === "~" || /^(\.{1,2}|~)?\//.test(spec);

const isGitUrl = (spec: string) =>
  spec.includes("://") || spec.startsWith("git@") || spec.endsWith(".git");

const splitRef = (raw: string) => {
  const hash = raw.lastIndexOf("#");

  if (hash === -1) {
    return { spec: raw, ref: undefined };
  }

  const ref = raw.slice(hash + 1);

  if (ref === "") {
    throw new SourceError(`Empty ref after "#" in "${raw}".`);
  }

  return { spec: raw.slice(0, hash), ref };
};

const splitSkill = (spec: string) => {
  const match = SKILL_SELECTOR.exec(spec);

  if (match?.[1] === undefined || match[1] === "") {
    return { spec, skill: undefined };
  }

  return { spec: match[1], skill: match[2] };
};

const expandHome = (spec: string, home: string) =>
  spec.startsWith("~") ? home + spec.slice(1) : spec;

/** Canonical form of a git URL, so the same GitHub repo has one identity however it was written. */
const canonicalUrl = (url: string) => {
  const github = GITHUB_URL.exec(url);

  return github === null ? url : `https://github.com/${github[1]}/${github[2]}.git`;
};

const decodePath = (path: string, raw: string) => {
  try {
    return decodeURIComponent(path);
  } catch {
    throw new SourceError(`Can't read the path in "${raw}".`);
  }
};

/**
 * A github.com page link as a GitHub source: `…/tree/<ref>[/<path>]` is that folder, and
 * `…/blob/<ref>/<path>/SKILL.md` is the folder holding that SKILL.md. The ref is one path segment
 * (a branch with a `/` can't be told apart from the path), and `main` or `master` float with the
 * default branch instead of becoming a Pin. Undefined when `raw` isn't such a link.
 */
const githubPage = (raw: string): Source | undefined => {
  const match = GITHUB_PAGE.exec(raw);

  if (match === null) {
    return undefined;
  }

  const [, owner = "", repo = "", view, ref = "", rest = ""] = match;
  const segments = trimSlashes(decodePath(rest, raw)).split("/");

  if (view === "blob" && segments.at(-1) !== SKILL_FILE) {
    throw new SourceError(
      `"${raw}" links to a file. Link to a SKILL.md, or to a folder (…/tree/<ref>/<path>).`,
    );
  }

  return {
    kind: "github",
    url: `https://github.com/${owner}/${repo}.git`,
    path: (view === "blob" ? segments.slice(0, -1) : segments).join("/"),
    ref: FLOATING_BRANCHES.has(ref) ? undefined : ref,
    skill: undefined,
  };
};

/** The shorthand for a github.com page link, which is what a manifest stores; other sources as given. */
export const pageShorthand = (raw: string) => {
  const page = githubPage(raw.trim());

  return page === undefined ? raw : formatSource(page);
};

/** The `owner/repo` of a GitHub URL, or undefined for other hosts. */
export const githubRepo = (url: string) => {
  const github = GITHUB_URL.exec(url);

  return github === null ? undefined : `${github[1]}/${github[2]}`;
};

/**
 * Parse a Reference or `add` argument: `owner/repo[/path][@name][#ref]`, a git URL `[#ref]`, a
 * github.com page link (see `githubPage`), or a local directory. Relative local paths resolve
 * against `cwd`, and `~` expands to `home`.
 */
export const parseSource = (raw: string, cwd: string, home = homedir()): Source => {
  const trimmed = raw.trim();

  if (trimmed === "") {
    throw new SourceError("Empty source.");
  }

  const page = githubPage(trimmed);

  if (page !== undefined) {
    return page;
  }

  const { spec: withSkill, ref } = splitRef(trimmed);

  if (isLocal(withSkill)) {
    const { spec, skill } = splitSkill(withSkill);

    return { kind: "local", url: resolve(cwd, expandHome(spec, home)), path: "", ref, skill };
  }

  if (isGitUrl(withSkill)) {
    // A github.com https URL is the same repo as the shorthand, so it gets the same kind and key.
    const kind = githubRepo(withSkill) === undefined ? "git" : "github";

    return { kind, url: canonicalUrl(withSkill), path: "", ref, skill: undefined };
  }

  const { spec, skill } = splitSkill(withSkill);
  const github = GITHUB_SHORTHAND.exec(spec);

  if (github === null) {
    throw new SourceError(
      `Can't read source "${raw}". Use owner/repo[/path][@name][#ref], a git URL, or a local path.`,
    );
  }

  return {
    kind: "github",
    url: `https://github.com/${github[1]}/${github[2]}.git`,
    path: trimSlashes(github[3] ?? ""),
    ref,
    skill,
  };
};

/** Apply an object Reference's `path` and `ref` fields on top of its parsed `source`. */
export const withOverrides = (
  source: Source,
  path: string | undefined,
  ref: string | undefined,
): Source => ({
  ...source,
  path: path === undefined ? source.path : trimSlashes(path),
  ref: ref ?? source.ref,
});

/** The shortest string that parses back to this source; used as a stable key and for display. */
export const formatSource = (source: Source) => {
  const repo = githubRepo(source.url);
  const base = source.kind === "github" && repo !== undefined ? repo : source.url;
  const path = source.path === "" ? "" : `/${source.path}`;
  const skill = source.skill === undefined ? "" : `@${source.skill}`;
  const ref = source.ref === undefined ? "" : `#${source.ref}`;

  // Git URLs can't carry a path inline, so "//" marks it; the key is for display and lookup, not parsing.
  const gitPath = source.path === "" ? "" : `//${source.path}`;

  return source.kind === "github"
    ? `${base}${path}${skill}${ref}`
    : `${base}${gitPath}${skill}${ref}`;
};
