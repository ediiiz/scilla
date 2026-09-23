# Collection manifest format

Type: grilling
Status: resolved
Blocked by: 01, 03

## Question

What file makes a repo a Collection, and what is its schema? Decide the file name and format, and how it expresses: Collection metadata; Own Skills (implicit discovery vs explicit listing); References (single skill vs whole repo/folder, include/exclude filters, optional Pin); recommended vs optional marking; and renaming or aliasing a referenced skill.

## Comments

- From the skills CLI research: `skills` reads `owner/repo@name` as a skill selector and puts refs after `#`. Before settling the Reference syntax, reconsider the planned `@ref` (vs `#ref`) so the two tools don't read the same string differently.

## Answer

Settled in a grilling session (2026-09-22).

- **File**: `scilla.json` at the repo root, JSON with a `$schema` URL. Its presence makes a repo a Collection.
- **Metadata**: `name` (required), `description` (required), `homepage` (optional). No `version`: Collection versioning stays in the fog, and a git ref covers it for now.
- **Own Skills**: found by scanning, not listed. The scan uses Traversal's discovery rules, skips installed-copy dirs (`.agents/skills`, `.claude/skills`, and similar agent dirs) and anything in the repo's own `skills-lock.json`. A top-level `exclude` trims the result.
- **References**: a `references` array. Each entry is a string, or an object with a `source` field that takes the same shorthand plus options.
  - Shorthand: `owner/repo[/path][#ref]`. This replaces the earlier `@ref`: `#` is the ref separator, matching the skills CLI and git-URL fragments. `owner/repo@name` selects one skill by name, as in the skills CLI.
  - Full git URLs: `url[#ref]`, with the subpath in the object's `path` field.
  - Single-skill vs folder/repo is **inferred**: a path that ends at a skill dir is a single-skill Reference; anything else gets scanned.
- **Pin**: any git ref (branch, tag or SHA) after `#` or in an object `ref`. The lock file records the resolved commit, so immutability comes from the lock, not the manifest.
- **Filters**: `include`/`exclude` match skill-name globs (names, not paths, so upstream layout moves don't break them). Include runs first, then exclude. On a Reference to a Nested Collection, the filters apply to its full, flat traversed output.
- **Optional marking**: everything is recommended by default. `"optional": true` on a Reference marks all of its skills optional; a top-level `"optional": [name-globs]` marks single skills from any source.
- **Collisions**: a duplicate skill name inside one manifest's own output is a hard error, and the Curator fixes it with `exclude`. Collisions coming through Nested Collections go to Traversal semantics.
- **Renaming**: not in v1 (it would mean rewriting a third-party `SKILL.md`). Moved to the fog.

Example:

```json
{
  "$schema": "https://…/scilla.schema.json",
  "name": "Svelte skills",
  "description": "Everything you need for SvelteKit work",
  "exclude": ["*-draft"],
  "optional": ["svelte-legacy-*"],
  "references": [
    "mattpocock/skills@tdd",
    "anthropics/skills/skills/pdf#9f3c2a1",
    { "source": "sveltejs/ai-tools/skills#next", "exclude": ["*-internal"] },
    { "source": "https://git.example.com/team/skills.git", "path": "skills", "optional": true }
  ]
}
```
