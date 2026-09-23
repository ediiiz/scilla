# The `skills` CLI: lock format, install layout, discovery

Research for [issue 01](../issues/01-skills-cli-ecosystem.md). Date: 2026-09-22.

## Sources

- npm package `skills`, v1.7.0, published 2026-09-17. `repository` points to `vercel-labs/skills`. <https://www.npmjs.com/package/skills>
- Source: <https://github.com/vercel-labs/skills>, read at commit `7407f38` (tag v1.7.0). Links below are pinned to that commit; `SRC` = `https://github.com/vercel-labs/skills/blob/7407f3893ad4dceab546ac002c3ef806e4000c73`.
- README: `SRC/README.md`
- This repo's `/skills-lock.json` and `.agents/skills/` + `.claude/skills/`, produced by `npx skills add mattpocock/skills`.

## 1. The two lock files

The CLI keeps **two different lock files** with different schemas. `skills-lock.json` is the **project** one.

### Project lock: `./skills-lock.json` (`SRC/src/local-lock.ts`)

It sits in the project root (`getLocalLockPath`), and the code comment says it is "meant to be checked into version control". The shape:

```ts
interface LocalSkillLockFile { version: number; skills: Record<string, LocalSkillLockEntry> }
interface LocalSkillLockEntry {
  source: string;        // "owner/repo" for GitHub; the full URL for SSH/non-github HTTPS; a relative path for local
  sourceUrl?: string;    // original URL, written only for sourceType "git" | "gitlab" (and well-known)
  ref?: string;          // branch/tag/SHA, written only when the user gave one (`#ref`)
  sourceType: string;    // "github" | "gitlab" | "git" | "local" | "well-known" | "node_modules"
  skillPath?: string;    // repo-relative path to SKILL.md, e.g. "skills/engineering/tdd/SKILL.md"
  computedHash: string;  // sha256 hex of the skill folder contents (see below)
  subagents?: string[];  // Eve-agent only
  wellKnownDigest?: string; // well-known sources only
}
```

- `CURRENT_VERSION = 1`. On read, a missing or older `version`, or any parse error (merge-conflict markers, for example), makes the CLI treat the lock as **empty**. It does not raise an error (`readLocalLock`).
- The file is keyed by skill **name**, the `name` from the SKILL.md frontmatter. Keys are sorted alphabetically when written, the JSON uses 2-space indent with a trailing newline, and there are **no timestamps**. The code comment says this is deliberate: branches that add different skills then produce merges git can resolve cleanly.
- There is **no record of which agents or which install mode** (symlink or copy) were used.
- Local sources are stored relative to the project (`./…`) and resolved back to absolute paths on read.
- The CLI writes this lock only for project-scoped installs. It is not written for `-g` installs or direct-download URLs (`SRC/src/add.ts` ~L2130–2165).

**`computedHash` algorithm** (`computeSkillFolderHash`):
1. Recursively collect every regular file under the skill folder. `.git/` and `node_modules/` are skipped.
2. Sort by POSIX relative path using `String.prototype.localeCompare`.
3. Feed one SHA-256 with `relativePath` followed by the raw file bytes for each file, **with no separator**, then take the hex digest.

The CLI hashes the **source** skill folder in the temp clone (`skill.path`), not the installed copy. When it installs from a skills.sh blob snapshot, it takes the server's `snapshotHash` instead (`add.ts` ~L2070–2080). I ran this algorithm over this repo's installed `.agents/skills/<name>/` folders and **all 25 hashes match `skills-lock.json`**. This means (a) the algorithm is as described, and (b) for these skills the installed copy is byte-identical to the source. `copyDirectory` does leave out `metadata.json`, `.git` and `__pycache__`, so a source that contains `metadata.json` would hash differently from its installed copy.

### Global lock: `~/.agents/.skill-lock.json` (`SRC/src/skill-lock.ts`)

It lives at `$XDG_STATE_HOME/skills/.skill-lock.json` when that variable is set, and at `~/.agents/.skill-lock.json` otherwise. `CURRENT_VERSION = 3`, and older versions are wiped. Its entries differ from the project lock:
- `sourceUrl` is **required**.
- It uses `skillFolderHash` (the **GitHub tree SHA** of the skill folder, from the Trees API) instead of `computedHash`. For non-GitHub sources it falls back to the sha256 folder hash.
- It adds `installedAt`/`updatedAt` ISO timestamps and an optional `pluginName`/`sourceBaseUrl`.
- It has top-level `dismissed` and `lastSelectedAgents`.

## 2. How `update` uses the locks (`SRC/src/update.ts`, `SRC/src/update-source.ts`)

`skills update [names] [-g|-p] [-y]`, also available as `check` and `upgrade`. Scope is `project`, `global` or both. With `-y` or no TTY it auto-detects: project if `skills-lock.json` exists or `.agents/skills/*/SKILL.md` exists, otherwise global.

**Global update** detects changes:
- For `github` sources, it fetches the repo tree once per `(source, ref)` group and compares each skill's tree SHA at `skillPath` with the stored `skillFolderHash`.
- If a locked `skillPath` is missing from the tree, it clones the repo with `--depth 1`, re-discovers every skill with `fullDepth`, and resolves relocations by name (`skill-relocation.ts`). Skills that are gone prompt for deletion (skipped when non-interactive). Name matches that are ambiguous are skipped.
- Entries without `skillFolderHash` or `skillPath` (local, git, private) are listed as "cannot be checked automatically".
- Every changed skill is reinstalled by spawning `skills add <source>/<folder>[#ref] --skill <name> -g -y`.

**Project update does not compare `computedHash` at all.** For each non-local, non-node_modules entry that has a `skillPath`:
1. It groups the entry by `(sourceUrl||source, ref)`, shallow-clones the repo, re-discovers skills, and handles deletions and relocations as above.
2. It then **unconditionally re-runs** `skills add <source>/<folder>[#ref] --skill <name> -y` for every remaining skill. That rewrites the skill folder (the target is `rm -rf`'d first) and the lock entry.

The update source is built as follows:
- GitHub shorthand: `owner/repo/<dirname(skillPath)>`.
- GitLab/github HTTPS: the folder is appended.
- SSH or generic `.git` URLs: the URL plus `--full-depth`.

Legacy entries without `skillPath` get a "reinstall manually" hint. Local modifications to installed skills are **silently overwritten**. The only place `computedHash` is compared is `experimental_sync` (the node_modules sync, `SRC/src/sync.ts` L200–206), where it is used to skip skills that are already up to date.

**`experimental_install`** (`SRC/src/install.ts`) restores every entry from `skills-lock.json` by calling `runAdd` per source. It installs **only into `.agents/skills/`** (the universal agents). It **floats**: it does not pin to the hash, and a `ref` is honoured only if one was recorded. The hash is not checked after download.

## 3. Install layout (`SRC/src/installer.ts`, `SRC/src/agents.ts`)

- **Canonical copy**: `<project>/.agents/skills/<name>/`, or `~/.agents/skills/<name>/` for global. `<name>` is `sanitizeName(frontmatter.name)`: lowercased, and every run of characters outside `[a-z0-9._]` becomes `-`.
- **Symlink mode** (the default and the "Recommended" interactive choice): the CLI copies files into the canonical dir, then creates a **relative symlink** from each non-universal agent's dir. For example, `.claude/skills/tdd -> ../../.agents/skills/tdd`, which is exactly what this repo has. On Windows it creates a junction. If symlinking fails it falls back to a copy.
- **Copy mode** (`--copy`): the CLI copies straight into each agent's dir and skips the canonical dir.
- **Universal agents**: any agent whose `skillsDir === '.agents/skills'` reads the canonical dir directly and gets no symlink. At the project level that includes Amp, Codex, Cursor, Gemini CLI, GitHub Copilot, OpenCode, Cline, Warp, Zed, Kilo, Droid and others.
- A **project** install skips the symlink for a non-universal agent (Claude Code's `.claude/`, for example) when that agent's root dir does not already exist in the project (`shouldSkipProjectAgentSymlink`).
- **Global** paths are agent-specific: Claude Code uses `$CLAUDE_CONFIG_DIR/skills` or `~/.claude/skills`, Codex uses `~/.codex/skills`, Amp uses `~/.config/agents/skills`, and so on. For universal agents, the global canonical dir `~/.agents/skills` is used with no extra link.
- **Agents supported**: 79 agent entries in `agents.ts`. The README table lists every agent with its project and global path. The CLI auto-detects installed agents (`detectInstalled`, usually by checking for a home config dir) and prompts when it finds none. `--agent '*'` selects all agents.
- Installing is destructive: `cleanAndCreateDirectory` `rm -rf`s the target before copying. The CLI refuses to install onto the source path.

## 4. Discovering SKILL.md in a repo (`SRC/src/skills.ts`, `SRC/src/plugin-manifest.ts`)

1. A valid skill is a directory with `SKILL.md` whose YAML frontmatter has string `name` and `description`. Anything else is skipped with a warning. `metadata.internal: true` hides the skill unless `INSTALL_INTERNAL_SKILLS=1` is set or the skill is requested by name.
2. If the search path (repo root or given subpath) itself has `SKILL.md`, the CLI returns just that skill, unless `--full-depth` is given.
3. Otherwise it walks these "priority" containers:
   - The root, depth 1.
   - `skills/`, `skills/.curated/`, `skills/.experimental/`, `skills/.system/`, and ~30 agent dirs (`.agents/skills`, `.claude/skills`, …), each **up to depth 3** (`DEFAULT_SKILL_CONTAINER_DEPTH`). Depth 3 covers `skills/<cat>/<cat>/<name>/SKILL.md`, and mattpocock/skills uses `skills/<category>/<name>/`.
   - The walk stops descending below a found skill, so a shallower SKILL.md shadows deeper ones. It skips `node_modules`, `.git`, `dist`, `build` and `__pycache__`.
4. **Plugin manifests**: `.claude-plugin/marketplace.json` (`metadata.pluginRoot`, `plugins[].source`, `plugins[].skills`) and `.claude-plugin/plugin.json` (`skills`) add search dirs at depth 1 and label skills with `pluginName`. The interactive picker **groups** skills by it, and the global lock stores it. Only **local, relative (`./`) plugin sources** are used. Object or remote `source` entries (`{source, repo}`) are **skipped**.
5. **Fallback**: if nothing was found, or `--full-depth` is set, the CLI does a recursive search up to depth 5.
6. The **first name wins**, so duplicate names are dropped (except during update checks).
7. **The CLI ignores already-installed skills.** When the scanned directory has its own `skills-lock.json`, any skill under an agent dir (`.agents/skills`, `.claude/skills`, …) whose name is in that lock is excluded (`isInstalledProjectSkill`). A repo that consumed third-party skills via `skills add` therefore does not re-publish them.

Other things a source can be:
- A subpath (`owner/repo/path` or a `/tree/<ref>/<path>` URL).
- A single skill by name (`owner/repo@skill-name`, or `--skill`).
- A ref, given via URL fragment `#ref`. You can combine them as `#ref@skill` (`SRC/src/source-parser.ts`).
- GitLab, Azure DevOps, any git URL, or a local path.
- A direct SKILL.md or archive URL.
- A "well-known" site index at `/.well-known/agent-skills/index.json`, with legacy fallback `/.well-known/skills/index.json` (`SRC/src/providers/wellknown.ts`).

Cloning is done with `git clone --depth 1 [--branch ref]`, with SHA fallback (`SRC/src/git.ts`). For GitHub sources with no explicit ref, the CLI may skip cloning and fetch pre-built snapshots from the `skills.sh/api/download` API (`SRC/src/blob.ts`).

## 5. Collections or references?

**No.** Nothing in the source models a skill set that points at other repos: there is no dependency, include or reference field in SKILL.md, the locks or the manifests. The nearest existing ideas:
- **Plugin grouping** (`pluginName` from `.claude-plugin/marketplace.json`) is a label over skills **within the same repo**. Remote plugin sources are explicitly skipped.
- **Well-known `index.json`** is a flat list of skills that one site hosts.
- **`skills find`** searches the skills.sh registry (`--owner` narrows the search to an org).
- There is no recursion or Traversal, so each `add` resolves exactly one source.

## Compatibility implications for scilla (facts, no decisions)

- **Scilla can write `skills-lock.json` in the same format** (version 1, name-keyed, sorted, no timestamps, `computedHash` as specified above). If it does, `npx skills update`, `experimental_install`, `list` and `remove` will operate on scilla-installed skills. They treat each entry as a plain `source` + `skillPath` and know nothing about which Collection it came from.
- **The format has no room for Collection provenance, Pin versus float intent, a resolved commit SHA, recommended/optional status, or the Consumer's earlier selection.** `ref` is the only version field, and the CLI reuses it verbatim as the clone ref. Unknown extra fields, from reading the code (I did not run a round-trip test):
  - Extra fields on an entry the CLI doesn't touch are kept, because `writeLocalLock` passes those entries through.
  - An entry the CLI adds or updates is **replaced wholesale** (`lock.skills[name] = entry`), so any extra fields on it are lost.
  - The top level is rebuilt as `{version, skills}`, so **extra top-level keys are dropped** whenever the `skills` CLI writes the file.
- **`skills update` overwrites local edits and ignores `computedHash`** for project installs. If scilla has its own local-edit policy, running `npx skills update` in the same project bypasses it.
- **The shorthand grammar differs.** In `skills`, `owner/repo@x` means "the skill named x", and a ref goes after `#`. The current scilla note (`owner/repo[/path][@ref]`) gives `@` the opposite meaning.
- **Layout convention**: the canonical files go in `.agents/skills/<sanitized-name>/`, and non-universal agents get relative symlinks into it (only when that agent's project dir already exists). Copying this layout makes scilla-installed skills visible to the ~79 agents the CLI targets, and lets `skills` manage them.
- **Discovery compatibility**: a Collection whose Own Skills live under `skills/` (up to 3 levels) or `.claude-plugin` manifests is already installable with plain `npx skills add`, which gets the Own Skills only. The CLI **ignores** anything scilla installs into the Collection repo's own agent dirs if they are listed in that repo's `skills-lock.json`. References are invisible to it.
- The global lock (`~/.agents/.skill-lock.json`, v3, GitHub tree SHA plus timestamps) is a separate schema. Being compatible at global scope would mean following that schema as well.
