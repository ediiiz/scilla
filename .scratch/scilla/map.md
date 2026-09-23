# Scilla

Label: wayfinder:map

## Destination

**Redrawn 2026-09-22**: the user stopped planning and asked for v1 to be scaffolded and built. The spec at `spec.md` records every remaining decision (made by the agent on delegation), and the effort now ends at a working v1 in this repo. The original destination is kept below for history.

A v1 spec at `.scratch/scilla/spec.md`, with every design decision settled (Collection format, Traversal, install/lock model, CLI surface, TUI flows, stack) and ready to hand to `/to-tickets` and build. Planning only: the map is done when nothing is left to decide.

## Notes

- Domain: a Bun + TypeScript TUI/CLI (`bunx scilla-cli`) that installs agent skills from **Collections** (see `CONTEXT.md` for the vocabulary; keep it current with the `domain-modeling` skill).
- UI: tuiparts.sh on OpenTUI, **React** flavour. Missing components (list, multiselect, tree, spinner…) are built on tuiparts **primitives**; the available recipes are Button, Input, Number Field, Slider, Textarea, Checkbox, Checkbox Group, Switch, Toggle, Toggle Group, Collapsible, Accordion, Tabs, Radio Group, Dialog.
- Settled while charting (no ticket needed):
  - A Collection is a git repo holding Own Skills + References. A Reference targets a single skill or a whole repo/folder.
  - Traversal scans repos for skills and recurses into Nested Collections, with cycle detection.
  - The TUI serves the Consumer fully and the Curator minimally (init, add Reference, add Own Skill). Hand-editing the manifest stays valid.
  - References float by default, with an optional Pin; a lock file records what was actually installed.
  - Consumer verbs: `bunx scilla add <owner/repo>` (Traversal, then picker, then install), `update`, `delete`. Bare `scilla` opens the TUI home screen. Curator verbs are a separate small set.
  - Install to the project by default; `--global` installs to the user level.
  - References accept GitHub shorthand `owner/repo[/path][#ref]` (`@name` selects one skill, as in the skills CLI) or any git URL (changed from `@ref` by Collection manifest format). Fetching goes through `git`, so private-repo auth uses the user's own git credentials.
  - The Curator marks skills recommended (pre-ticked, the default) or optional.
  - On `update`, skills that are new upstream show as **new** and must be opted into; the Consumer's earlier selection is remembered.
  - Trust v1: show each skill's origin (repo, path, commit) and warn when a skill contains executable files. No sandboxing.
- Prefer compatibility with the existing `skills` CLI ecosystem (`skills-lock.json`, `.agents/skills`) unless research shows it doesn't fit.
- Standing preference: every grilling ticket also calls `domain-modeling`.
- **Delegation (2026-09-22)**: the user has handed every remaining decision to the agent. Grilling tickets are now resolved by the agent alone: the agent states each decision and its reasoning in the Answer, flags anything contentious to the user, and doesn't wait for answers. The TUI flows prototype is built and judged by the agent. The one-ticket-per-session limit still applies.
- **Fixed dev toolchain (user)**: OpenTUI (React) + tuiparts for the UI; this is fixed despite the fragility found in OpenTUI and tuiparts feasibility, so only how to pin or vendor them is open. A Turborepo monorepo on Bun workspaces, scoped `@scilla/*` package names, oxlint (oxc) for linting, oxfmt for formatting, fallow as the code checker with a **strict** rule set (every check on, as errors, unless research shows one is unworkable), and https://github.com/dmmulroy/anti-slop adopted. Stack and distribution designs around these rather than choosing among alternatives.

## Decisions so far

<!-- one line per resolved ticket: [title](issues/NN-slug.md): gist -->
- [OpenTUI and tuiparts feasibility](issues/02-opentui-tuiparts-feasibility.md): Feasible but fragile. OpenTUI needs Bun >=1.3 or Node >=26.4 (experimental FFI). Its prebuilt Zig libs ship as optional per-platform packages. A `#!/usr/bin/env bun` bin works via `bunx`; via `npx` only if Bun is installed. tuiparts 0.0.6 has no list or tree primitive (collection engine internal), so the tree-multiselect is CheckboxGroup + Collapsible + scrollbox with app-owned Tab and scroll-follow (sketch passed under headless `testRender`). Risks: tuiparts peers `^0.4.3`, which excludes the current OpenTUI 0.5.x. It breaks in patch releases and appears to have one maintainer.
- [Skills CLI ecosystem and lock format](issues/01-skills-cli-ecosystem.md): vercel-labs/skills writes a simple name-keyed `skills-lock.json` (source/sourceType/skillPath/sha256 computedHash, optional ref). Files go in `.agents/skills` with relative symlinks for the other agents. Project `update` reinstalls everything without checking the hash. It has no collections or references, and its `@` selects a skill (refs go after `#`). Compatible writes are feasible but can't hold Collection or Pin data.
- [Skill repo conventions in the wild](issues/03-skill-repo-conventions.md): The spec fixes only the skill dir and 6 frontmatter fields. Real repos add Claude-only keys and use flat, bucketed, plugin-nested and build-duplicated layouts. Reliable discovery needs priority containers, stop-at-first-skill, dedup-by-name and manifest hints (see skills CLI). `marketplace.json` offers the richest cross-repo prior art (`github`/`url`/`git-subdir` sources with `ref`+`sha`, `strict:false` + `skills[]` curation, `renames`).
- [Collection manifest format](issues/04-collection-manifest-format.md): `scilla.json` at the root (JSON + `$schema`; name, description, homepage). Own Skills are scanned, not listed. References are strings or objects using `owner/repo[/path][#ref]` and `@name`; single vs folder is inferred; the Pin is any git ref. Filters are name globs, optional marking works per Reference and by name list, a duplicate name inside a manifest is an error, and there's no rename in v1.
- [Monorepo toolchain: Turborepo, oxlint, oxfmt, fallow](issues/10-monorepo-toolchain.md): All four run under Bun 1.4 workspaces (isolated linker); turbo handles `bun.lock` + prune. oxlint 1.x stable, oxfmt 0.x beta, fallow 3.x (fallow-rs, knip-like dead-code/dupes/cycles, young, pin exact). Run lint/format/fallow as turbo root tasks (`//#lint`, `//#format`, `//#check`), with build/typecheck/test per package. Bundle the CLI with `bun build --production` (OpenTUI/React external) and keep `@scilla/*` as JIT `workspace:*` devDeps. Turn off oxlint `react/react-in-jsx-scope`; set fallow `includeEntryExports: true`.
- [Strict fallow rules and anti-slop](issues/11-strict-fallow-and-anti-slop.md): anti-slop is a vendored Oxlint JS plugin (18 rules, alpha plugin API, no ESLint/Biome, npm name squatted, don't install) that works with oxlint 1.85/Bun/turbo but in practice needs a schema library (zod) at I/O boundaries. Strict fallow (all rules `error`) is workable if you ignore the vendored dir plus `@oxlint/plugins`, set `duplicates.threshold: 0.001` (clones never fail otherwise), and run `fallow health --coverage-gaps` and `fallow security` as separate root tasks. No anti-slop/fallow overlap; only oxlint's `style` category contradicts anti-slop.

- [Traversal semantics](issues/05-traversal-semantics.md), [Install and lock model](issues/06-install-and-lock-model.md), [CLI surface](issues/08-cli-surface.md), [Stack and distribution](issues/09-stack-and-distribution.md): decided by the agent on delegation. See [spec.md](spec.md).
- [TUI flows prototype](issues/07-tui-flows-prototype.md): skipped; built directly in `packages/tui`.

- 2026-09-22: v1 is implemented in `packages/core`, `packages/tui` and `apps/cli`. All gates pass (`bun run verify`, `check:security`) and a sandboxed end-to-end smoke test passed. Publishing is blocked: the npm names `scilla` (a security holding package) and `@scilla` (a scope owned by someone else) are taken.

## Not yet specified

- **Custom component inventory**: exactly which components to build on the primitives (tree-multiselect, list, spinner, status/log pane) and how they're styled. Waits on the TUI prototype and the OpenTUI/tuiparts research.
- **Fetching & caching**: clone cache location, shallow vs sparse checkout, parallelism, offline behaviour, GitHub rate limits for shorthand lookups.
- **Error UX**: a Reference that doesn't exist or has moved, a missing Pin, a broken Nested Collection. Does one bad Reference fail the whole install or degrade it?
- **Local edits to installed skills**: what `update` does when the Consumer has modified an installed skill (overwrite, skip, diff?). Probably part of the lock/install model, but not sharp yet.
- **Collection versioning**: does a Collection itself get versions or releases that Consumers can pin, or is it only a git ref?
- **Renaming referenced skills**: aliasing a third-party skill to avoid collisions means rewriting its `SKILL.md` `name` on install. Ruled out of the Collection manifest format for v1; revisit together with local edits to installed skills.
- **Testing strategy** for a TUI plus git-backed Traversal (fixtures, fake repos).

## Out of scope

- Sandboxing or security review of third-party skill contents. v1 only shows origin and warns about executables.
- A hosted registry or search website for discovering Collections.
