# Skills CLI ecosystem and lock format

Type: research
Status: resolved
Blocked by:

## Question

How does the existing `skills` CLI (the tool that produced this repo's `skills-lock.json`, i.e. `npx skills add mattpocock/skills`) work, and can scilla be compatible with it?
- The lock file schema and semantics (`source`, `sourceType`, `skillPath`, `computedHash`), and how `update` uses them.
- The install layout: `.agents/skills` vs `.claude/skills` (copies? symlinks?), global vs project, and which agents it supports.
- How it discovers `SKILL.md` files in a repo (conventions, depth, `skills/` folder, marketplace files).
- Whether it has any notion of collections or references already.

Findings feed the lock/install model and whether scilla writes a compatible lock or its own.

## Answer

- `skills` is `vercel-labs/skills`, published on npm as `skills` (v1.7.0). It keeps two lock files. The project one, `./skills-lock.json`, is version 1, keyed by frontmatter name, sorted, with no timestamps. Each entry holds `source`, `sourceType`, `skillPath` (repo-relative path to SKILL.md), `computedHash`, and optionally `ref`/`sourceUrl`. The global one, `~/.agents/.skill-lock.json`, is v3 and uses the GitHub tree SHA plus timestamps.
- `computedHash` = sha256 over (relative path + file bytes) for every file in the skill folder, sorted by path. I checked this against all 25 entries in our lock and every one matched.
- For project skills, `update` never compares `computedHash`. It clones again, handles moved or deleted skills, then re-runs `skills add <source>/<folder>[#ref] --skill <name>` for every skill, which overwrites local edits. Only the global update checks for changes (by GitHub tree SHA).
- Install layout: the real files go in `.agents/skills/<name>/`, and every other agent gets a relative symlink to it (for example `.claude/skills/x -> ../../.agents/skills/x`). The symlink is only made if that agent's folder already exists in the project. `--copy` copies instead. `-g` installs to `~/.agents/skills` or the agent's own global folder. It supports 79 agents.
- Discovery: a SKILL.md at the root, else `skills/` (plus `.curated/.experimental/.system`) and about 30 agent skill folders, searched up to 3 levels deep; skills listed in `.claude-plugin/marketplace.json`/`plugin.json` (local paths only); a recursive fallback. Skills that the scanned repo itself installed (listed in its own `skills-lock.json`) are ignored.
- It has no collections or references. The closest things are `pluginName` grouping (same repo only; remote plugin sources are skipped) and well-known `index.json` sites.
- The two tools read shorthand differently. In `skills`, `owner/repo@name` selects a skill by name and a ref goes after `#`, so `@` doesn't mean the same as in scilla's `@ref`. The lock has nowhere to store which Collection a skill came from or whether it is pinned, and when `skills` rewrites the file it drops any top-level keys it doesn't know.
- Details: [research file](../research/skills-cli-ecosystem.md)
