# Concepts

These are the words scilla uses, in its output and in these docs.

## Collections

**Collection**: a git repo (or a local folder) managed by scilla that bundles Own Skills and
References into one installable, curated set, such as "svelte skills". What makes it one is its
Manifest.

**Manifest**: the `scilla.json` file at the Collection's root. It declares the Collection's name,
description and References. Own Skills are found by scanning, not listed. See
`scilla docs manifest`.

**Own Skill**: a skill whose files live inside the Collection itself: any folder with a `SKILL.md`
that the scan finds.

**Reference**: a pointer from a Collection to skills that live in another repo: a single skill, or
a whole repo or folder of skills. A Reference can filter by name (`include`, `exclude`), mark its
skills `optional`, and carry a Pin. See `scilla docs sources`.

**Nested Collection**: a Collection reached through a Reference, because the Reference points at a
folder with its own `scilla.json`. Its own References are followed in turn.

**Traversal**: following References outward from a Collection, scanning repos for skills and
recursing into Nested Collections, to produce the full set of installable skills. `add`, `update`
and `check` all start with one.

**Pin**: an optional fixed git ref (tag, branch or commit) on a Reference, written `#ref`. Without
one, the Reference floats to upstream's latest (the default branch's `HEAD`).

## Roles

**Curator**: the person who creates and maintains a Collection (`init`, `ref add`, `skill new`,
`check`).

**Consumer**: the person who installs skills from a Collection into a project or their home
directory (`add`, `update`, `delete`, `list`, `audit`).

## How a Traversal decides

- The target is the source's repo at the resolved commit, narrowed to its path. A target folder
  with `scilla.json` is a Nested Collection; one with `SKILL.md` is a single skill; anything else
  is a plain folder that gets scanned.
- The scan walks up to 6 levels deep and stops at the first `SKILL.md` on each branch. It skips
  `.git`, `node_modules` and dot-folders (except `.curated`, `.experimental` and `.system`), so
  installed copies in `.agents` or `.claude` are never picked up.
- A skill's name comes from its `SKILL.md` frontmatter `name`, else its folder name.
- Filters apply in order: the source's `@name`, then `include`, then `exclude`, matched against
  skill names with globs.
- A skill is optional when any level marks it so: a Reference's `optional: true`, or a Manifest's
  `optional` globs.
- The same skill reached twice (same repo, path and commit) is kept once.
- Two different skills with the same name in one Collection's output are a collision. If both come
  straight from that Manifest (Own Skills or a plain Reference), the Traversal fails. If either
  came through a Nested Collection, the first in Manifest order wins (Own Skills first), with a
  warning.
- A cycle back to a Collection already on the path is skipped with a warning; nesting stops at
  depth 8.
- A Reference that can't be fetched or resolved becomes a warning and its skills are missing. A bad
  `scilla.json` anywhere is fatal, and so is a root Collection that can't be fetched.
