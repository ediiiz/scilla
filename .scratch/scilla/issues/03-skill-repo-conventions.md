# Skill repo conventions in the wild

Type: research
Status: resolved
Blocked by:

## Question

How are skills laid out in real repos that Collections will reference? Look at e.g. `anthropics/skills`, `mattpocock/skills`, Svelte's official AI skills if they exist, and Claude Code **plugin marketplaces** (`marketplace.json`) as prior art for "referencing third-party skills".
- `SKILL.md` frontmatter fields (name, description, others) and folder structure (scripts, assets).
- How skills are grouped (category folders, nested `skills/`), and how a tool can reliably find all skills in a repo.
- What prior-art manifest formats exist for pointing at skills elsewhere, and what we can borrow for the Collection manifest.

## Answer

- Spec (agentskills.io): a skill is a dir with `SKILL.md`. Only six frontmatter fields exist: `name` (required, must equal the dir name), `description` (required), `license`, `compatibility`, `metadata`, `allowed-tools`. Optional dirs are `scripts/`, `references/`, `assets/`. The spec says nothing about where skills live in a repo, and it defines no manifest.
- Real skills go beyond the spec: Claude Code keys (`disable-model-invocation`, `argument-hint`, `user-invocable`, `version`…) are common. `metadata` is sometimes non-string (Svelte `internal: true`, mattpocock nested maps). Name/dir mismatches exist. Executable `scripts/` are common. Lenient parsing is the recommended client behaviour.
- Layouts vary: flat `skills/<name>` (anthropics), category buckets `skills/<bucket>/<name>` (mattpocock, where WIP/deprecated status is only a folder convention), plugin-nested `plugins/<p>/skills/<name>` (official marketplace), and build-copied duplicates in 4 places (sveltejs/ai-tools). Installed third-party copies (`.agents/skills`, `.claude/skills`) also show up inside repos.
- The `skills` CLI discovers skills by: priority containers (`skills/`, `skills/.curated|.experimental|.system`, ~30 agent dirs) walked to depth 3; stopping below a found skill; adding local paths from `.claude-plugin/marketplace.json`/`plugin.json` (remote sources skipped); full recursive fallback (depth 5) only if nothing was found; dedup by `name`; hiding `metadata.internal: true`; ignoring skills that its own `skills-lock.json` lists as installed.
- Claude Code `marketplace.json` is the main prior art for cross-repo references. Plugin `source` is `./path`, `github {repo, ref?, sha?}`, `url {url, ref?, sha?}`, `git-subdir {url, path, ref?, sha?}`, npm, archive or command. `sha` beats `ref`. `strict: false` + `skills: [...]` lets a curator choose which skill dirs of a repo are exposed. The `renames` map handles moved entries. All 258 remote entries in claude-plugins-official are pinned by `sha`.
- The `skills` CLI shorthand `owner/repo@name` means a skill-name filter, not a git ref (refs go in `#fragment`). This clashes with the map's `owner/repo[/path][@ref]`. Its `skills-lock.json` records `source`, `ref?`, `skillPath`, and a content `computedHash`, but no commit SHA.
- Full findings with citations: [../research/skill-repo-conventions.md](../research/skill-repo-conventions.md)
