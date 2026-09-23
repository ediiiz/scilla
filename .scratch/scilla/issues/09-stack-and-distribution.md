# Stack and distribution

Type: grilling
Status: resolved
Blocked by: 02, 10, 11

## Question

Given the OpenTUI/tuiparts research, lock the stack. Decide:
- the runtime (Bun only, or Node too)
- packaging for `bunx scilla` (and `npx`?), including any native deps
- how tuiparts recipes are vendored
- the git access approach (shell out to `git` vs a library)
- the test tooling and project layout

## Comments

- From the OpenTUI research, things to decide here:
  - OpenTUI needs Bun >=1.3 or Node >=26.4 with FFI. Node 24 fails.
  - A `#!/usr/bin/env bun` bin works under `bunx`, and under `npx` only if Bun is installed.
  - tuiparts 0.0.6 declares `@opentui/* ^0.4.3`, while OpenTUI is now at 0.5.12. It works, but Bun warns about peers.
  - tuiparts ships breaking changes in patch releases and appears to have one maintainer. Consider pinning exact versions or vendoring its components.
- From the user (2026-09-22): the toolchain is fixed as Turborepo + Bun workspaces, `@scilla/*` scoped packages, oxlint, oxfmt and fallow. The layout must be extensible and modern. This ticket decides the package split, which package is published as `scilla`, and how internal packages get bundled. Module-level seams (agent targets, source types) should follow Traversal semantics and Install and lock model; leave room for them rather than fixing them here. Toolchain facts: Monorepo toolchain.
- From Strict fallow rules and anti-slop: anti-slop is an Oxlint JS plugin, **vendored as source** and pinned by commit (never `npm i oxlint-plugin-anti-slop`: that npm name belongs to an unrelated package). Excluding it from fallow/oxfmt is part of the layout. Its rules make a schema library at every I/O boundary effectively mandatory (zod passed in testing), so choose one here. fallow's strict gate needs separate `health --coverage-gaps` and `security` tasks plus a positive `duplicates.threshold`. The complexity gate needs Istanbul coverage, which `bun test` can't produce, so the test tooling decision interacts with it.

## Answer

Decided by the agent under the user's delegation (2026-09-22) when the user skipped the remaining planning and asked to build v1. Recorded in [spec.md](../spec.md), section "Stack and layout"; this ticket holds no separate detail.
