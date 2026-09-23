# Monorepo toolchain: Turborepo, oxlint, oxfmt, fallow

Type: research
Status: resolved
Blocked by:

## Question

The user fixed the dev toolchain: a **Turborepo** monorepo with scoped `@scilla/*` packages, **oxc** (oxlint) for linting, **oxfmt** for formatting, and **fallow** as a code checker. Before Stack and distribution can lay out the repo, establish the facts:
- Turborepo on **Bun workspaces**: how well it's supported (lockfile `bun.lock`, pruning, caching), and the current recommended `turbo.json` shape (`tasks`, `dependsOn`, root tasks vs package tasks).
- **oxlint** and **oxfmt**: current versions and maturity, config files (`.oxlintrc.json`, oxfmt config), TypeScript/React/JSX support, and whether to run them per package through turbo or once at the root.
- **fallow**: what exactly it is (confirm the tool, e.g. an unused-code / dead-export / dependency checker for JS/TS), its maintainer, version, config, monorepo/workspace support, and how it's run in CI.
- How a published CLI package in a Bun workspace depends on internal `@scilla/*` packages: bundle them into one publishable artifact (e.g. `bun build`) vs publish each; how `workspace:*` is handled on publish.
- Any known conflicts between these tools and OpenTUI's React/JSX setup (`jsxImportSource`).

Findings feed Stack and distribution.

## Answer

- **Turborepo 2.11.2 on Bun 1.4.2 works first-class.** It reads the text `bun.lock`, caches (a second run was a FULL TURBO hit), and `turbo prune` produced a pruned `bun.lock` that installed with `--frozen-lockfile` (ran). New Bun workspaces default to the isolated linker (`node_modules/.bun`), and every tool here handled that layout. `turbo.json` shape: `tasks` with `build: { dependsOn: ["^build"], outputs: ["dist/**"] }`, `typecheck`/`test` per package, and root tasks `//#lint`, `//#format`, `//#check` (the `:fix` variants get `cache: false`). A root task hashes every tracked file in the repo, so it invalidates correctly.
- **oxlint 1.85.0 is stable** (1.x since 2025-06; type-aware linting stable since 2026-07 via `oxlint-tsgolint`). **oxfmt 0.70.0 is beta** (since 2026-02; Turbo's guide still says "alpha", which is out of date). Configs are `.oxlintrc.json` and `.oxfmtrc.json`, both nestable, with `$schema` pointing into `node_modules`. Both handle TS/TSX/JSX natively. Turbo's oxc guide recommends running both once at the root as root tasks, not per package. Commit a `.gitignore` first: oxlint only skips `node_modules` through `.gitignore`, and without one it linted `node_modules/.bun` (ran).
- **fallow is real and unambiguous.** `fallow` 3.28.0 on npm (`fallow-rs/fallow`, MIT, about 6 months old, mostly one maintainer, Bart Waardenburg; 2 majors and 225 releases, so pin an exact version). It is a Rust, knip-plus-jscpd-style analyser for unused files, exports and deps, cycles, duplication, complexity and boundaries, with an optional paid runtime layer. It auto-detects `workspaces` and ships plugins for bun, turborepo, oxlint, oxfmt and typescript. Run it as the root task `//#check`: `fallow` locally, `fallow audit` (only new findings) in PRs. Exit codes: 0 clean, 1 findings, 2 error. The GitHub Action is `fallow-rs/fallow@v3`.
- **fallow gotcha (ran):** unused exports of internal `@scilla/*` packages are *not* reported by default, because their `exports` entry counts as an entry point. Use `.fallowrc.json` `{ "$schema": "./node_modules/fallow/schema.json", "includeEntryExports": true }`.
- **Bun-only runtime:** the npm launchers for oxlint, oxfmt and fallow have `#!/usr/bin/env node` shebangs. `bunx --bun <tool>` runs them fine (ran), so a Node-free CI image works.
- **Publishing:** ship one bundled `scilla` package. `bun build ./src/index.tsx --target bun --production --outdir dist`, with `--external` for `@opentui/core`, `@opentui/react` and `react` (keep those in `dependencies`). Internal `@scilla/*` packages go in `devDependencies` as `workspace:*` and export `.ts` source (Turbo "Just-in-Time" packages), so they are inlined. `bun publish`/`bun pm pack` rewrites `workspace:*` to the concrete version (ran). Without `--production`, `bun build` emits `jsxDEV` from `@opentui/react/jsx-dev-runtime` (ran).
- **OpenTUI JSX conflicts (ran):** oxlint's `react/react-in-jsx-scope` (suspicious category) fires on every element under the automatic runtime, so set it to `"off"`. `react/no-unknown-property` (restriction, opt-in) flags OpenTUI props like `flexDirection`/`fg`, so leave it off. Skip `jsx-a11y`. oxfmt formatted OpenTUI TSX fine. fallow reads `jsxImportSource`, so it raised no false unused-dep findings for `@opentui/react`.
- Details: [research file](../research/monorepo-toolchain.md)
