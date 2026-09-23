# Skill repo conventions in the wild

Research for [issue 03](../issues/03-skill-repo-conventions.md). Gathered 2026-09-22. Findings only; no design decisions.

Sources read (shallow clones at the commit noted, plus live docs):

| Source | Commit / URL |
| --- | --- |
| Agent Skills spec + client guide | https://github.com/agentskills/agentskills @ `69ef37e` (published at https://agentskills.io/specification and https://agentskills.io/client-implementation/adding-skills-support) |
| anthropics/skills | https://github.com/anthropics/skills @ `34040c9` |
| mattpocock/skills | https://github.com/mattpocock/skills @ `c55ee46` |
| sveltejs/ai-tools (official Svelte skills) | https://github.com/sveltejs/ai-tools @ `5c15fbc` |
| anthropics/claude-plugins-official | https://github.com/anthropics/claude-plugins-official @ `db467cc` |
| vercel-labs/skills (the `skills` CLI behind `skills-lock.json` / `.agents/skills`) | https://github.com/vercel-labs/skills @ `7407f38` |
| Claude Code docs | https://code.claude.com/docs/en/skills, https://code.claude.com/docs/en/plugin-marketplaces, https://code.claude.com/docs/en/plugins-reference |

---

## 1. `SKILL.md` frontmatter and folder structure

### The spec (agentskills.io)

Source: https://agentskills.io/specification (repo `docs/specification.mdx`).

- A skill is **a directory containing `SKILL.md`**: YAML frontmatter, then a Markdown body.
- Frontmatter fields, and only these six:

  | Field | Required | Constraint |
  | --- | --- | --- |
  | `name` | yes | 1–64 chars, `[a-z0-9-]`, no leading/trailing/consecutive hyphens, **must match the parent directory name** |
  | `description` | yes | 1–1024 chars |
  | `license` | no | name or pointer to a bundled license file |
  | `compatibility` | no | ≤500 chars, environment requirements |
  | `metadata` | no | map, string → string, "reasonably unique" keys recommended |
  | `allowed-tools` | no | space-separated, experimental |

- Optional subfolders by convention: `scripts/` (executable code), `references/` (extra docs), `assets/` (templates, images, data). "Any additional files or directories" are allowed.
- File references are relative to the skill root; keep them one level deep. Keep `SKILL.md` under 500 lines.
- The reference validator `skills-ref` rejects any frontmatter key outside those six ("Unexpected fields in frontmatter", `skills-ref/src/skills_ref/validator.py`), and `find_skill_md` accepts `skill.md` as a lowercase fallback (`skills-ref/src/skills_ref/parser.py`).
- The client guide says to be **lenient** when loading: name/dir mismatch or a name over 64 chars gives a warning but still loads; a missing description or unparseable YAML skips the skill. It also recommends a fallback for unquoted values containing colons (https://agentskills.io/client-implementation/adding-skills-support, "Lenient validation", "Handling malformed YAML").
- The spec does not say *where* skill directories live. It only defines what goes inside one.

### Claude Code's superset

Source: https://code.claude.com/docs/en/skills#frontmatter-reference.

- Claude Code accepts extra fields: `when_to_use`, `argument-hint`, `arguments`, `disable-model-invocation`, `user-invocable`, `disallowed-tools`, `model`, `effort`, `context`, `agent`, `background`, `hooks`, `paths`, `shell`, plus the six spec fields. Unknown fields are **silently ignored**.
- In Claude Code **all** fields are optional (`name` defaults to the directory name, `description` to the first body line).
- claude.ai uploads, the Skills API and `package_skill.py` accept **only the six spec fields** and fail hard on any other key ("Unexpected key(s) in SKILL.md frontmatter: argument-hint…").
- Command name: for project/personal skills it comes from the **directory name** (frontmatter `name` is only a display label). For plugin skills it comes from frontmatter `name` (falling back to the directory), namespaced as `/plugin:name` (https://code.claude.com/docs/en/skills#how-a-skill-gets-its-command-name).
- `metadata` is a free-form map that Claude Code ignores. Non-map values are dropped.

### What real repos use

Frontmatter keys counted across every `SKILL.md` in each repo:

| Repo | Keys seen (count) |
| --- | --- |
| anthropics/skills (20 skills) | `name` 20, `description` 20, `license` 17 |
| mattpocock/skills (38) | `name` 38, `description` 38, `disable-model-invocation` 22, `argument-hint` 4, `metadata` 1 |
| sveltejs/ai-tools (10 files, 4 unique) | `name`, `description`, `metadata` 2, `disable-model-invocation` 1 |
| claude-plugins-official (31) | `name`, `description`, `version` 13, `allowed-tools` 8, `user-invocable` 7, `tools` 2, `license`, `disable-model-invocation`, `argument-hint` |

Observations:
- `name` and `description` are always present. Most other keys are Claude Code extensions, so many real skills would **fail the strict `skills-ref` validator**.
- `metadata` is not always string→string: mattpocock `skills/in-progress/pr/SKILL.md` nests a map (`metadata.credits.skill`), and Svelte uses the boolean `metadata.internal: true`.
- Name/dir mismatches do happen: `anthropics/skills/template/SKILL.md` (`name: template-skill`) and `claude-plugins-official/plugins/hookify/skills/writing-rules` (`name: writing-hookify-rules`).
- Folder contents beyond `SKILL.md`: anthropics uses a per-skill `LICENSE.txt`, loose reference `.md` files (`pdf/forms.md`, `pdf/reference.md`), `reference/` (not `references/`), and `scripts/` (pdf, pptx, mcp-builder). mattpocock uses loose `.md` files (`tdd/mocking.md`), `scripts/`, and an `agents/openai.yaml` in each skill (`interface.display_name`, `short_description`: UI metadata for OpenAI's Codex). So **executable files inside skills are common** (`scripts/`), which matters for the planned executable warning.

## 2. How skills are grouped, and reliable discovery

### Layouts seen

| Repo | Layout | Notes |
| --- | --- | --- |
| anthropics/skills | flat `skills/<name>/SKILL.md` | plus a `template/SKILL.md` at root level that is not a real skill |
| mattpocock/skills | category buckets `skills/<bucket>/<name>/SKILL.md` | buckets `engineering`, `productivity` (promoted), `misc`, `in-progress`, `deprecated`. `deprecated/` holds only a README. Bucket status is a repo convention in `CLAUDE.md`/`AGENTS.md`, not in frontmatter |
| sveltejs/ai-tools | source of truth `tools/skills/<name>/`, **copied by build scripts** into `plugins/claude/svelte/skills/`, `plugins/cursor/svelte/skills/`, `packages/opencode/skills/` (`scripts/sync-claude-plugin.ts`) | same skill appears **4 times**, byte-identical. Also `.agents/skills/` holds repo-internal skills marked `metadata.internal: true`, and a `skills-lock.json` shows it *consumes* a mattpocock skill |
| claude-plugins-official | `plugins/<plugin>/skills/<name>/SKILL.md` and `external_plugins/<plugin>/skills/<name>/SKILL.md` | many different plugins share skill names (`access`, `configure` in discord/imessage/telegram) |
| scilla itself (installed by `skills` CLI) | `.agents/skills/<name>/` real dirs, `.claude/skills/<name>` symlinks to them | installed skills live in the repo too |

Consequences for scanning a repo:
- Depth varies: 1 level (`skills/x`), 2 levels (`skills/bucket/x`), and plugin-nested (`plugins/p/skills/x`, 4 levels from the root).
- **Duplicates by name are normal**, from build copies (Svelte), independent plugins (official marketplace), and installed copies of other people's skills (`.agents/skills`, `.claude/skills`).
- Non-skills can carry a `SKILL.md` (anthropics `template/`). Deprecated or WIP buckets are only marked by folder convention.

### Discovery rules in the spec's client guide

Source: https://agentskills.io/client-implementation/adding-skills-support, "Step 1: Discover skills".

- Inside a skills directory, look for **subdirectories containing a file named exactly `SKILL.md`**.
- Skip `.git/` and `node_modules/`, optionally respect `.gitignore`, bound the scan ("max depth of 4-6 levels, max 2000 directories").
- `.agents/skills/` (project and user) is the cross-client convention. `.claude/skills/` is also commonly scanned.
- Name collisions: apply a deterministic rule (project overrides user; within a scope, first-found or last-found, consistently) and warn.

### Discovery in the `skills` CLI (vercel-labs/skills), the de-facto repo scanner

Source: `src/skills.ts` `discoverSkills`, `src/plugin-manifest.ts`, README "Skill Discovery" / "Plugin Manifest Discovery" (https://github.com/vercel-labs/skills#skill-discovery).

1. If the (sub)path itself has `SKILL.md`, return just that skill (unless `--full-depth`).
2. Otherwise walk **priority containers**: the root (depth 1 only), `skills/`, `skills/.curated/`, `skills/.experimental/`, `skills/.system/`, and ~30 agent dirs (`.agents/skills`, `.claude/skills`, `.codex/skills`, …). Named containers are walked up to depth 3 (`DEFAULT_SKILL_CONTAINER_DEPTH`), so `skills/<cat>/<name>` and `skills/<cat>/<cat>/<name>` work. Walking **stops below a found skill** ("a `SKILL.md` discovered at a shallower level shadows anything nested below it").
3. Add directories declared in `.claude-plugin/marketplace.json` (`plugins[].source` + `skills[]`, honouring `metadata.pluginRoot`) and `.claude-plugin/plugin.json` (`skills[]`), plus each plugin's `skills/`. **Only local `./` sources are followed. Remote `{source: github…}` entries are skipped.** Paths must start with `./` and stay inside the repo.
4. Only if **nothing** was found (or `--full-depth`): recursive search, max depth 5, skipping `node_modules .git dist build __pycache__`.
5. Deduplicate by frontmatter `name` (first wins). Skip skills with no `name`/`description` or bad YAML (with a warning). Hide `metadata.internal: true` unless `INSTALL_INTERNAL_SKILLS=1`. Skip skills under agent dirs that the repo's own `skills-lock.json` lists (installed copies, not sources).

How that plays out on the repos above:
- mattpocock: `skills/` depth-3 walk finds all 38, including `in-progress`/`misc`. The plugin manifest's curated list has no filtering effect because discovery is additive.
- Svelte: `tools/skills/` is not a priority container. The skills are found through the marketplace entry's `./plugins/claude/svelte` → `skills/`. `.agents/skills/*` are hidden as internal.
- anthropics: `skills/` finds the 20. `template/` is found only via the root depth-1 walk (it is directly under root). It is a real `SKILL.md` with `name: template-skill`.

### Claude Code's own discovery (for installed skills, not repos)

Source: https://code.claude.com/docs/en/skills#where-skills-live.
- `~/.claude/skills/<name>/SKILL.md`, `.claude/skills/<name>/SKILL.md` in cwd and parents up to the repo root, nested `<subdir>/.claude/skills/` loaded lazily, and plugin `skills/`. Symlinked skill folders are followed and loaded once. A folder named `synced` is reserved.
- A skill folder with `.claude-plugin/plugin.json` is loaded as a plugin `<name>@skills-dir`.

## 3. Prior-art manifests that point at skills elsewhere

### Claude Code marketplace (`.claude-plugin/marketplace.json`)

Source: https://code.claude.com/docs/en/plugin-marketplaces.

- Top level: `name` (kebab-case, some names reserved), `owner {name, email?, url?}`, `plugins[]`. Optional: `$schema`, `description`, `version`, `metadata.pluginRoot`, `allowCrossMarketplaceDependenciesOn`, `renames` (old name → new name or `null`).
- Plugin entry: `name`, `source` required. It can carry any `plugin.json` field (`description`, `version`, `author`, `homepage`, `repository`, `license`, `keywords`, …) plus `category`, `tags`, `strict`, `defaultEnabled`, free-form `metadata`, and component paths such as `skills` (string|array of dirs containing `<name>/SKILL.md`, or a dir that is itself a skill, e.g. `"."`).
- **Source types**:

  | `source` | Fields |
  | --- | --- |
  | `"./path"` string | relative to the marketplace root (dir holding `.claude-plugin/`). No `../` |
  | `github` | `repo` (`owner/repo`), `ref?`, `sha?` |
  | `url` | `url` (https or `git@`, `.git` optional), `ref?`, `sha?` |
  | `git-subdir` | `url` (also accepts `owner/repo` shorthand or SSH), `path`, `ref?`, `sha?`. Sparse partial clone |
  | `npm` | `package`, `version?`, `registry?` |
  | `archive` | `url`, `sha256?` |
  | `command` | `command`, `timeout?`, `mode?` |

- Pinning: `ref` = branch/tag, `sha` = full 40-char commit. When both are set, `sha` wins. Marketplace sources (where the catalog itself comes from) support `ref` but not `sha`, and are pinned independently of plugin sources.
- `strict` (default `true`): `plugin.json` is the authority and the marketplace entry adds to it. `false`: the marketplace entry is the **entire** definition, which lets a curator pick which files of someone else's repo are exposed as skills (it is a conflict if the plugin's own `plugin.json` also declares components).
- Path rules (https://code.claude.com/docs/en/plugins-reference#path-behavior-rules): the `skills` field **adds** to the default `skills/` scan, except for an entry whose source is the marketplace root, where listing subdirectories **replaces** the default scan. Paths must start with `./`, use `/`, and stay in the plugin root. Symlinks to elsewhere in the same marketplace are dereferenced on copy. Symlinks outside it are skipped.
- A marketplace fetched as a bare URL to `marketplace.json` cannot resolve relative sources.
- Name versioning and renames: plugin `version` pins updates to string changes. `renames` migrates users.

In practice:
- anthropics/skills: one repo, `source: "./"`, `strict: false`, and an explicit `skills: ["./skills/xlsx", …]` list per plugin. This is **curation by path list** over a single repo, grouping 20 skills into 5 installable sets.
- mattpocock: a marketplace with one plugin (`source: "./"`), and a `plugin.json` whose `skills` array names exactly the promoted subset.
- claude-plugins-official: 310 entries. 52 relative, 161 `url`, 97 `git-subdir`. **All 258 remote entries carry a `sha`**, and 96 also carry a `ref`. Uses `renames`. `$schema: https://anthropic.com/claude-code/marketplace.schema.json`.
- Svelte: one relative plugin with inline `lspServers`.
- Note: marketplace entries point at **plugins** (a directory), not at individual skills. A single external skill is reached with `git-subdir` + `path` to a directory that is itself a skill (plugin-root `SKILL.md` is loaded as a single-skill plugin), or with `strict: false` + a `skills` list.

### `skills` CLI source strings and lock file

Sources: `src/source-parser.ts`, `src/local-lock.ts`, README "Source Formats".

- Accepted sources: `owner/repo`, `owner/repo/path/to/skill`, **`owner/repo@skill-name` (the `@` is a skill-name filter, not a git ref)**, `github:`/`gitlab:` prefixes, GitHub/GitLab tree URLs (`/tree/<branch>/<path>`), Azure Repos URLs (`?path=…&version=GB<branch>`), any git URL (SSH or HTTPS), local paths, and "well-known" HTTPS endpoints. Refs are otherwise carried as a URL **`#fragment`**. Subpaths with `..` are rejected.
- Well-known discovery: `https://host/.well-known/agent-skills/index.json` (legacy `/.well-known/skills/`). v1 entries are `{name, description, files[]}`. v2 entries are `{name, type: skill-md|archive, description, url, digest}` with `$schema: https://schemas.agentskills.io/discovery/0.2.0/schema.json` (that schema URL did not resolve when checked on 2026-09-22).
- `skills-lock.json` (project, committed): `{version: 1, skills: {<name>: {source, sourceUrl?, ref?, sourceType, skillPath?, computedHash, …}}}`. `skillPath` is the path to `SKILL.md` inside the source repo. `computedHash` is SHA-256 over the skill folder's files. There is **no commit SHA** in the local lock.

### The spec itself

The Agent Skills spec defines no manifest, registry or cross-repo reference format. It only defines the skill directory. (The v2 well-known discovery schema above is namespaced under agentskills.io but is not in the published docs index at https://agentskills.io/llms.txt.)

## Relevance to a Collection manifest (facts, not decisions)

- Nobody puts per-skill "recommended/optional" or bucket status into `SKILL.md`. Where it exists, it lives in a manifest (plugin.json `skills` list, marketplace plugin groupings) or in folder conventions (mattpocock buckets, `skills/.experimental`, `metadata.internal`).
- Both main prior arts split "where" (`source`: repo URL/shorthand + optional subpath) from "which version" (`ref` and/or `sha`), and the official marketplace pins every remote entry by `sha`.
- The shorthand `owner/repo@x` already means **skill name** in the `skills` CLI, while the map's settled Reference syntax uses `@ref`. The `skills` CLI uses `#ref` for refs.
- A scan that follows only the spec ("dirs containing SKILL.md") over a whole repo will find build copies, installed third-party copies, templates and internal skills. Existing tools cope with priority containers, stop-at-first-skill, dedup-by-name, `metadata.internal`, and ignoring lock-listed installed skills.
