# Strict fallow rules and anti-slop

Type: research
Status: resolved
Blocked by:

## Question

The user wants **strict fallow rules** and to adopt **https://github.com/dmmulroy/anti-slop**. Establish the facts Stack and distribution needs to configure both:
- **anti-slop**: what it is (lint rules? an oxlint/eslint plugin? agent skills or prompts? a config preset?), how it's installed and wired in, what it enforces, its version/maturity and maintainer, and whether it works with oxlint, oxfmt, Bun and a Turborepo monorepo, or only with another toolchain.
- **fallow strict**: the full list of fallow checks and their severity knobs; what a maximal-strictness config looks like (every check on, as errors); which checks are noisy or unworkable for a Bun + OpenTUI React TSX monorepo with a bundled CLI; and how it fails CI.
- Any overlap or conflict between anti-slop, fallow and oxlint (duplicate rules, contradictory rules).

Findings feed Stack and distribution.

## Answer

- **anti-slop is an Oxlint JS plugin, not a prompt pack, and it doesn't need ESLint or Biome.** It has 18 opinionated AST rules (no ad hoc `typeof`, no `unknown` params/returns, no `Record<string, unknown>`, `// SAFETY:` comments on every `as`, no `filter().map()`, no `vi.mock`, autofixed blank-line spacing) plus an opt-in Effect set that scilla doesn't need. You vendor it; it's not a dependency. `dmmulroy/anti-slop` has one main author, is about 6 weeks old, and its latest tag `v0.1.2` is behind `main` `c44ef22`. Its `install-anti-slop` agent skill copies it to `tools/oxlint/anti-slop/` and pins `@oxlint/plugins` at exactly the oxlint version. The npm name `oxlint-plugin-anti-slop` is squatted by an unrelated publisher, so never install it.
- **It works with scilla's toolchain (ran):** oxlint 1.85.0 via `.oxlintrc.json` `jsPlugins`, Bun isolated workspaces, `bunx --bun`, the turbo `//#lint` root task, and a stable `oxlint --fix` + `oxfmt` loop. Two gotchas: oxfmt reformats the vendored plugin unless it's in `.oxfmtrc.json` `ignorePatterns`, and Oxlint JS plugins are still an alpha API. anti-slop's real cost is design: a hand-written `typeof` manifest validator got 8 errors, and a zod schema cleared them. So plan on a schema library at every I/O boundary and on naming catch parameters `cause`. Its mocking ban doesn't catch `bun:test`'s `mock.module`.
- **Strict fallow is workable with four adjustments (ran):** exclude `tools/oxlint/anti-slop/**` (otherwise the vendored code alone produced 91 complexity findings, clones and an unused `effect/` dir) and put `@oxlint/plugins` in `ignoreDependencies`. Set `duplicates.threshold: 0.001`, because clones never fail CI otherwise, even with `--fail-on-issues`. Run `fallow health --coverage-gaps` and `fallow security` as separate tasks, because bare `fallow` doesn't enforce those rules. Suppress `coverage-gaps` on the bin entry with a reasoned `fallow-ignore-file` comment (`overrides` and `ignoreFindings` don't affect it).
- **Recommended `.fallowrc.json`:** `minimumVersion` 3.28.0, `includeEntryExports`, every applicable rule at `error` (including the opt-ins `private-type-leaks`, `prop-drilling`, `thin-wrapper`, `duplicate-prop-shape`, `coverage-gaps`, `require-suppression-reason` and the security rules; `feature-flags` at `warn`), `duplicates.mode: "mild"` (`semantic` was about 5× noisier), and the default health thresholds. Leave `production` unset. Scripts: `check` = `fallow`, `check:tests` = `fallow health --coverage-gaps`, `check:security` = `fallow security`, each a turbo root task. The full configs are in the research file.
- **Strictest parts in practice:** estimated CRAP fails any untested function with cyclomatic ≥ 5, and `bun test` can't emit the Istanbul coverage that fallow needs for exact scores. Beyond that, `includeEntryExports` flags unused barrel re-exports, and `private-type-leaks` forces component props types to be exported. React props of exported components are exempt from `unused-component-props`, but oxlint's `no-unused-vars` catches them.
- **Conflicts:** anti-slop and fallow don't overlap. With oxlint on correctness+suspicious+perf there's no conflict. The `style` category contradicts anti-slop (`unicorn/catch-error-name` wants `error`, anti-slop wants `cause`, so set its `name: "cause"`; `unicorn/prefer-reflect-apply` goes against `no-reflect-apply`). Turning on every oxlint category is unworkable on its own terms, since its restriction rules contradict each other.
- Details: [research file](../research/strict-fallow-and-anti-slop.md)
