# Strict fallow rules and anti-slop

Research for [issue 11](../issues/11-strict-fallow-and-anti-slop.md). Date: 2026-09-22. Builds on [monorepo-toolchain.md](monorepo-toolchain.md) and doesn't repeat it (fallow basics, turbo root tasks, `includeEntryExports`).

## Sources

- **anti-slop**: <https://github.com/dmmulroy/anti-slop>, cloned at commit `c44ef22` (2026-09-10, HEAD of `main`). `AS` = that tree. Read: `README.md`, `package.json`, `AGENTS.md`, `src/index.ts`, `src/rules/*.ts`, `skills/install-anti-slop/SKILL.md`, `skills/install-anti-slop/references/update.md`, `skills/install-anti-slop/scripts/install.mjs`, `.github/workflows/ci.yml`. Git tags and `git shortlog`. GitHub API (`gh api repos/dmmulroy/anti-slop`, `gh release list`).
- npm registry (`npm view`, 2026-09-22): `oxlint-plugin-anti-slop`, `@oxlint/plugins` 1.85.0 (repo `oxc-project/oxc`), `fallow` 3.28.0 (unchanged since the previous research).
- Oxc website source at commit `15bb6c0` (2026-09-21). `WEB` = `src/docs/guide/usage/linter/`. Read: `js-plugins.md`, `writing-js-plugins.md`, `rules/unicorn/prefer-reflect-apply.md`, `rules/unicorn/catch-error-name.md`, and the category headers of several other rule pages.
- fallow source at commit `2c13513` (2026-09-22). `FSRC` = that tree. Read: `schema.json` (the `RulesConfig`, `HealthConfig`, `DuplicatesConfig`, `DetectionMode`, `AuditConfig` and `ConfigOverride` definitions and the top-level keys) and `README.md` ("Commands", "Output and exit codes", "CI"). Also the output of `fallow explain <rule>`, `fallow --help`, `fallow health --help`, `fallow dupes --help` and `fallow security --help` from the 3.28.0 binary.
- **Experiment (ran)**: a new throwaway monorepo in the session scratchpad (`strict/`), laid out like the previous one. It used Bun 1.4.2, turbo 2.11.2, oxlint 1.85.0, `@oxlint/plugins` 1.85.0, oxfmt 0.70.0, fallow 3.28.0, `@opentui/core`/`@opentui/react` 0.5.12 and zod 4.6.5. `packages/core` (`@scilla/core`, JIT `.ts` exports) held a manifest parser, a class, a barrel and `bun test` files. `packages/cli` (`scilla`, bin, `.tsx` with `useKeyboard` and a `<Picker>` component) depended on it through `workspace:*`. anti-slop was vendored with its own install script into `tools/oxlint/anti-slop/`. Everything marked "ran" comes from this repo, and everything else is from reading.

## 1. What anti-slop is

**It is a set of lint rules written as an Oxlint JS plugin. It is not a prompt pack or a config preset, and it doesn't need ESLint or Biome.** The README opens: "Opinionated Oxlint rules that reject low-evidence and low-signal TypeScript and JavaScript patterns" (`AS/README.md`). `src/index.ts` builds the plugin with `eslintCompatPlugin` from `@oxlint/plugins`. The rules use Oxlint's ESTree and scope APIs, and `AGENTS.md` says "do not add another production parser". The repo also ships one **agent skill**, `install-anti-slop`, but it only installs and updates the plugin.

- **Distribution: vendored, not a dependency.** "This project is meant to be vendored … There is no official npm package. Copy the rules into your repository, read them, and change them" (README). `package.json` is `"name": "oxlint-plugin-anti-slop", "version": "0.1.2", "private": true`, with `exports: ./src/index.ts`. It ships TypeScript source and has no build step.
- **Warning: the npm name is taken by someone else.** `oxlint-plugin-anti-slop@0.0.0` on npm was published on 2026-08-12 by `gameroman`, with license "Proprietary" and no repository. That is not the author (read `npm view`). Do not `npm install` it.
- **Maintainer and maturity:** Dillon Mulroy (`dmmulroy`) wrote 31 of 35 commits. The other 4 come from three outside contributors, including the Effect rules by Kyle Mistele. The repo was created on 2026-08-12 and has about 4.8k stars and an MIT license. Tags `v0.1.0`, `v0.1.1` and `v0.1.2` were all cut on 2026-08-31, and there are **no GitHub releases** (`gh release list` is empty). Nine commits have landed since `v0.1.2`, including the `require-readable-spacing` rule and the array rules, so `main` is ahead of the latest tag. The README calls it "the ruleset I use with my work … my preferences and taste rather than … a universal coding standard". Upstream CI runs `pnpm check` (oxlint, RuleTester suites, `tsc`, a skill-asset drift check) on Node 24, and upstream pins `oxlint`/`@oxlint/plugins` **1.78.0**.
- **Runtime dependency:** production source imports only `@oxlint/plugins`. The `node:*` imports and `oxlint/plugins-dev` are used only by tests (grep of `AS/src`). About 4.4k lines of non-test TS, plus a vendored MIT copy of ESLint Stylistic's padding engine (`src/vendor/eslint-stylistic/`, with `LICENSE` and `UPSTREAM.md`).
- **Platform risk it inherits:** Oxlint JS plugins are documented as **"currently in alpha, and remain under active development"**, and they don't support "lint rules that rely on TypeScript type-awareness" (`WEB/js-plugins.md`). anti-slop works around the second point on purpose: its rules resolve same-file aliases only and "do not infer imported type definitions or cross-file call signatures" (README, "Analysis boundaries").

### What it enforces

There are 18 generic rules, plus a native companion rule it asks you to enable. All are recommended at `"error"` (README, SKILL.md step 3):

| Rule | Rejects |
|---|---|
| `oxc/no-accumulating-spread` (native oxlint, `perf` category) | spreads of the accumulator in reducers and loops |
| `no-array-filter-map` | adjacent eager `.filter().map()` / `.map().filter()`. Use `.values().filter().map().toArray()`, `flatMap`, or a mutating reducer |
| `no-reduce-accumulator-copy` | `Object.assign({}, acc, …)`, `acc.concat`, `acc.slice()` and similar copies inside reducers |
| `no-chained-type-assertions` | `x as A as B` |
| `no-conditional-empty-object-spread` | `...(cond ? { k } : {})` |
| `no-known-value-widening` | a known value flowing into `unknown`/`object`/an open `Record` target, e.g. `const h: Record<string, H> = { start }` |
| `no-module-mocking` | `vi.mock` / `jest.mock` / `doMock` / `unstable_mockModule` |
| `no-object-parameters` | `object`-typed parameters |
| `no-reflect-apply`, `no-reflect-get` | `Reflect.apply`, `Reflect.get` |
| `no-runtime-typeof` | ad hoc `typeof x === "string"` narrowing ("parse input at its I/O boundary"). `typeof x === "undefined"` is allowed. Option `allowInTypeGuards` |
| `no-shape-in-symbol-names` | the substring `shape` in your own identifiers |
| `no-unknown-parameters` / `no-unknown-returns` / `no-unknown-type-aliases` | `unknown` on inputs, return contracts and aliases. Exceptions: a parameter named `cause`, and a type predicate's subject |
| `no-unsafe-dictionary-type` | `Record<string, unknown \| any \| object \| {}>` value types |
| `no-widen-then-assert` | widen to `unknown` and later assert back |
| `require-readable-spacing` (autofix) | missing blank lines between top-level declarations and around multi-line bindings, control flow and returns |
| `require-safety-comment-for-type-assertion` | any non-`const` `as` without a preceding `// SAFETY: …` comment (markers configurable) |

There is also an opt-in `anti-slop-effect` plugin with 5 rules, meant only for repos that depend on `effect` directly. scilla doesn't, so leave it out.

### How it installs (read, then ran)

- **Via the agent skill:** `npx skills add dmmulroy/anti-slop --skill install-anti-slop`, then ask the agent to install it. `SKILL.md` has it: (1) run `node <skill>/scripts/install.mjs [dest]`, which copies `assets/anti-slop` to `tools/oxlint/anti-slop/` and refuses to overwrite; (2) install `@oxlint/plugins` at **exactly** the repo's resolved oxlint version, as a devDependency; (3) merge `jsPlugins`, the rule list and `ignorePatterns` for agent directories (`.agents/**`, `.claude/**`, …) plus the vendored directory into the existing oxlint config; (4) run lint and typecheck, reporting findings without suppressing them; (5) write an `UPSTREAM.md` provenance record with the exact source commit. A separate `references/update.md` describes a three-way-merge update procedure. There is no auto-update.
- **Manually:** copy `src/` yourself. The skill's `assets/` copy is kept identical to `src/` minus the tests by CI's drift check.
- **Ran:** `node anti-slop/skills/install-anti-slop/scripts/install.mjs` from the scratch repo root copied the plugin (no tests) to `tools/oxlint/anti-slop/`. I added `@oxlint/plugins: "1.85.0"` next to `oxlint: "1.85.0"` in the root devDependencies and merged the rules into `.oxlintrc.json`. JSON config works; `oxlint.config.ts` isn't required, and `jsPlugins` with `{ name, specifier }` works in `.oxlintrc.json` too.

### Compatibility with scilla's toolchain (ran)

- **oxlint 1.85.0**: works, even though upstream pins 1.78.0. The `.ts` plugin entry loads directly. Under the Node launcher (Node 24.15) it prints a `MODULE_TYPELESS_PACKAGE_JSON` warning because the root `package.json` has no `"type": "module"`. Under `bunx --bun oxlint` it runs with no warning. Either way the exit code is 1 on findings. Lint time on the small repo was about 0.3 s.
- **Bun workspaces (isolated linker)**: `@oxlint/plugins` resolves from the vendored directory to the root `node_modules`. No workspace entry is needed for `tools/`.
- **oxfmt**: **gotcha.** `oxfmt` reformatted all 35 vendored plugin files (tabs to spaces, and so on), because the README only tells you to add format ignores for Vite+. Add `tools/oxlint/anti-slop/**`, plus the agent directories, to `.oxfmtrc.json` `ignorePatterns`, or accept that the vendored copy gets reformatted and diverges from upstream, which makes the three-way merge noisier.
- **oxfmt vs `require-readable-spacing`**: no fight. `oxlint --fix`, then `oxfmt`, then a second `oxlint --fix` and `oxfmt` pass left the tree unchanged, so the result is stable.
- **Turborepo**: nothing special. It runs inside the existing `//#lint` root task. Because root tasks hash every tracked file, editing a vendored rule invalidates lint as it should.
- **OpenTUI TSX**: nothing TUI-specific fired. On the realistic sample, the findings were `require-readable-spacing` (autofixed) and `no-conditional-empty-object-spread` on `{ border: true, ...(footer ? { title: footer } : {}) }` in a component.
- **The rules that matter for scilla**: a hand-written `JSON.parse` + `typeof` manifest validator got **8 errors**: 4× `no-runtime-typeof`, plus `no-unsafe-dictionary-type` (`as Record<string, unknown>`), `require-safety-comment-for-type-assertion` and 2× `no-conditional-empty-object-spread`. Rewriting it as a zod 4 schema (`ManifestSchema.parse(JSON.parse(raw))`, `type Manifest = z.infer<…>`) lint-cleaned it with zero anti-slop errors. **So in practice anti-slop requires a schema/parsing library at every I/O boundary** (scilla.json, lock file, SKILL.md frontmatter, git output), or turning on `allowInTypeGuards` and writing type predicates. Catch handlers must name their `unknown` parameter `cause`: `(error: unknown) => …` is rejected, `(cause: unknown) => …` passes.
- **bun:test**: `no-module-mocking` only recognises `vi` and `jest` (from `vitest` / `@jest/globals`) (`AS/src/rules/no-module-mocking.ts`). Bun's `mock.module()` is **not** caught, so the "no module mocking" policy doesn't cover `bun test` unless you extend the vendored rule.
- **Iterator helpers**: the `no-array-filter-map` suggestion `.values().filter().map().toArray()` runs on Bun 1.4.2 (ran `bun -e`).

## 2. fallow: every check and its knobs

fallow has three families of findings, each gated differently. This matters for "every check on, as errors".

### a. `rules`: severity per issue type (`error` | `warn` | `off`)

`error` fails with exit 1, `warn` reports and exits 0, and `off` means the check doesn't run (`FSRC/schema.json` `Severity`, README "Output and exit codes"). All 53 keys in `RulesConfig` as of 3.28.0, with their defaults:

- **Dead code, default `error`:** `unused-files`, `unused-exports`, `unused-types`, `unused-dependencies`, `unused-enum-members`, `unused-class-members`, `unresolved-imports`, `unlisted-dependencies`, `duplicate-exports`, `circular-dependencies`, `boundary-violation`, `unresolved-catalog-references`, `misconfigured-dependency-overrides`, `route-collision`, `dynamic-segment-name-conflict`.
- **Default `warn`:** `unused-dev-dependencies`, `unused-optional-dependencies`, `type-only-dependencies`, `test-only-dependencies`, `dev-dependencies-in-production`, `re-export-cycle`, `stale-suppressions`, `unused-catalog-entries`, `empty-catalog-groups`, `unused-dependency-overrides`, `policy-violation`, `unused-component-props`, and the framework ones (`unused-store-members`, `unprovided-injects`, `unrendered-components`, `unused-component-emits`, `unused-component-inputs`, `unused-component-outputs`, `unused-svelte-events`, `unused-server-actions`, `unused-load-data-keys`, `invalid-client-export`, `mixed-client-server-barrel`, `misplaced-directive`) and the CSS ones (`css-token-drift`, `css-duplicate-block`, `css-selector-complexity`, `css-dead-surface`, `css-broken-reference`).
- **Opt-in, default `off`:** `private-type-leaks`, `prop-drilling`, `thin-wrapper`, `duplicate-prop-shape` (React graph signals), `coverage-gaps`, `feature-flags`, `require-suppression-reason`, `security-client-server-leak`, `security-sink`.
- **No-ops for scilla** (Vue, Svelte, Angular, Pinia, Next.js/RSC, SvelteKit, pnpm catalogs, CSS): the framework, catalog and CSS rules above. Setting them to `error` costs nothing, and it keeps them on if the stack ever grows.
- `overrides` re-severities rules per glob (`ConfigOverride`). File and line suppressions are `// fallow-ignore-file <rule> -- <reason>` and `// fallow-ignore-next-line <rule> -- <reason>`.

### b. Health: numeric thresholds, not severities

`health.maxCyclomatic` (default 20), `maxCognitive` (15), `maxCrap` (30.0), `maxUnitSize` (60 lines per function), `crapRefactorBand` (5), per-file `thresholdOverrides`, and `ignore` (`HealthConfig`). **Ran:** a function over the threshold (cyclomatic 17, cognitive 26) made bare `fallow` exit 1 ("Failed: … health (1 above threshold)"). `fallow health --min-score N` is a separate 0–100 score gate, but setting it makes complexity findings *informational* (`health --help`), so don't combine the two in one invocation.

**CRAP without coverage is estimated, and it is the strictest knob.** CRAP = cc² × (1 − cov)³ + cc. fallow estimates coverage from the static test graph as "85% direct, 40% indirect, 0% untested" (health output). **Ran:** the untested cc-17 function scored exactly 306 (17² + 17). So under the default `maxCrap: 30`, **any untested function with cyclomatic ≥ 5 fails**. For exact scores fallow wants Istanbul `coverage-final.json`. **`bun test` only emits `text` and `lcov`** (`bun test --help`), and fallow reads only Istanbul (`FSRC/crates/*/health/coverage*.rs` handle `IstanbulCoverage` only), so scilla gets the estimate unless it converts lcov to Istanbul.

### c. Duplication: a threshold, not a severity

`duplicates.mode` (`strict` | `mild` default | `weak` | `semantic`), `minTokens` 50, `minLines` 5, `minOccurrences` 2, `threshold` (percent, **0 = no limit**), `near`, `skipLocal`, `crossLanguage`, `ignoreImports`, `ignoredClones` (`DuplicatesConfig`). `strict` and `mild` are "currently equivalent" (exact clones). `weak` also ignores string literals. `semantic` ignores all identifiers and literals, so it catches renamed copies (`DetectionMode`).

- **Surprise (ran): clones do not fail CI by default.** With clone groups present and `threshold` unset, bare `fallow` printed `✗ … duplicated` and still exited **0**. `--fail-on-issues` didn't change that, and `fallow dupes` alone also exited 0. Only after I set `duplicates.threshold` to `0.001` did it exit 1 ("Duplication (17.1%) exceeds threshold (0.0%)", "Failed: dupes"). So "dupes as errors" means setting a tiny positive `threshold`.
- **Ran:** two copies of a 9-line function that differed only in identifiers were found by `semantic` only. `strict`, `mild` and `weak` found nothing. On anti-slop's own 4.4k-line source (tests and skill copy excluded), `mild` reported 1.8% duplication and `semantic` 9.6% across 16 files. `semantic` is roughly 5× noisier on real, visitor-heavy code.

### d. Checks that bare `fallow` doesn't run

- `coverage-gaps` appears only under **`fallow health`** (default sections) or `fallow health --coverage-gaps`. The bare combined run never showed it (ran). With the rule at `error`, `fallow health --coverage-gaps` exited 1 (ran). It is *static reachability from test files*, not line coverage: one test that imports `packages/core/src/index.ts` marked every file behind that barrel as covered (ran). `overrides` and `ignoreFindings` did **not** suppress it, but `// fallow-ignore-file coverage-gaps -- <reason>` did, and didn't then raise a stale-suppression finding (ran). The CLI bin entry (`src/index.tsx`, which renders at import time) can't sensibly be imported by a test, so it needs that suppression. Every TUI component file needs at least one test that reaches it (OpenTUI's headless `testRender`, per [issue 02](../issues/02-opentui-tuiparts-feasibility.md)). `health --help` says `--coverage-gaps` "requires type-aware analysis". It worked without that in 3.28.0 (ran), so the help text is inaccurate or out of date.
- `security-*` findings show up **only** under `fallow security`, "never … under bare `fallow` or the `audit` gate" (`security --help`). Ran: `eval(code)` was flagged (CWE-94, exit 1), but `Bun.spawn([... url])` and `` Bun.$`git clone ${url}` `` were **not** flagged. `--gate` (exit 8) requires a diff source and deliberately has no whole-backlog mode.
- `feature-flags` appears only under `fallow flags`. It recognises `FEATURE_*`/`ENABLE_*`/`FF_*`-style env vars and known SDKs, and it ignored `process.env.SCILLA_DEBUG` (ran). Informational.
- `fallow audit` (changed files; `audit.gate: "new-only"` default or `"all"`) is the PR gate from the previous research.

### What fired on the scratch repo with every rule at `error` (ran)

- `unused-files` (a stray `.tsx`), `unused-class-members` (`SkillTree.unusedMethod`), and `unused-types` on a **type re-export from the `@scilla/core` barrel that the CLI never imports**. That last one needs `includeEntryExports`, and it is correct but strict: barrels may only re-export what's consumed.
- `private-type-leaks`: `export function Picker({…}: PickerProps)` with a non-exported `interface PickerProps`. Every exported React component's props type must be exported. Exporting it did **not** then trigger `unused-types` (ran), so the two rules don't conflict.
- `stale-suppressions` **plus** `require-suppression-reason`: one bare `// fallow-ignore-next-line unused-export` produced both findings.
- `unused-dev-dependencies`: **`@oxlint/plugins`** is reported once the vendored plugin directory is excluded from analysis. Its only importer is the ignored code. Fix it with `ignoreDependencies`.
- `unused-component-props` did **not** fire on an unused prop of the exported `Picker`. By design, React exported "public-API component props" are exempt (`fallow explain unused-component-props`).
- `prop-drilling`, `thin-wrapper` and `duplicate-prop-shape` didn't fire on the sample. They run because `react` is a declared dependency.
- `dev-dependencies-in-production` did **not** fire on `@scilla/core` (a `workspace:*` devDependency imported by the bundled CLI), not even under `--production` (ran). The previous research's bundling layout is safe.
- `production: true` would force `unused-dev-dependencies` and `unused-optional-dependencies` to `off` (schema). **Don't** set it in a strict config. Use `--production` ad hoc.

### The vendored anti-slop directory and fallow (ran)

fallow's oxlint plugin reads `jsPlugins` and treats `tools/oxlint/anti-slop/index.ts` as an entry point ("4 entry points: 2 package.json, 2 plugin"). If the directory is left in the analysis, the vendored code itself fails the strict gate: 8 unused files (the whole `effect/` plugin, which nothing registers), 13 unused exports, 4 clone groups and **91 functions over the complexity thresholds**. That's unworkable, so exclude it with `ignorePatterns` and add `@oxlint/plugins` to `ignoreDependencies`. After that the gate is clean. (The alternative is deleting `effect/` and refactoring vendored AST code to pass fallow's health thresholds, which fights the upstream merge procedure.)

## 3. Overlaps and conflicts

- **anti-slop vs fallow: no rule overlap.** anti-slop is per-file AST policy (types, assertions, spacing). fallow is cross-file graph, duplication and complexity. The only interaction is the one above: fallow must ignore the vendored plugin, and it then needs `ignoreDependencies: ["@oxlint/plugins"]`.
- **anti-slop vs native oxlint** (read from rule pages, plus a probe run with every category at `error`):
  - `oxc/no-accumulating-spread` is anti-slop's declared companion. It's already in the `perf` category, and anti-slop wants it at `error`, so the two agree.
  - **`unicorn/catch-error-name`** (`style` category) wants catch parameters named `error`. anti-slop's `no-unknown-parameters` rejects `(error: unknown) =>` and allows only `cause`. **Ran:** in the probe each rule flagged the other's preferred form. Resolve with `"unicorn/catch-error-name": ["error", { "name": "cause" }]` or leave `style` off. This is a direct contradiction only if the `style` category is enabled.
  - **`unicorn/prefer-reflect-apply`** (`style`, off by default) prefers `Reflect.apply(fn, null, args)`, which is exactly what `anti-slop/no-reflect-apply` bans. It's a contradiction in intent; in my probe the unicorn rule didn't fire on `fn.apply(null, args)` with a typed parameter, but `eslint/prefer-spread` did. Keep it off.
  - `unicorn/no-array-reduce` (`restriction`) bans the reducers that anti-slop recommends as an alternative to `filter().map()`. That's not a contradiction, since `flatMap` and iterator helpers satisfy both, but you shouldn't enable both and follow anti-slop's advice blindly.
  - `typescript/no-unsafe-type-assertion` (`suspicious`, **type-aware**) and `typescript/consistent-type-assertions` (`style`) overlap with `require-safety-comment-for-type-assertion` and `no-chained-type-assertions`. They're complementary, not contradictory.
  - Turning on **every** oxlint category (`pedantic`, `style`, `restriction`) is unworkable on its own terms, regardless of anti-slop. On a 17-line probe it fired `import/no-named-export` **and** `import/group-exports` on every export, `eslint/func-style`, `eslint/id-length`, `eslint/no-undefined`, `eslint/no-magic-numbers` and `oxc/no-async-await`. Several restriction rules contradict each other or scilla's style. "Strict oxlint" should mean `correctness`, `suspicious` and `perf` at `error`, plus hand-picked rules, not all categories.
- **anti-slop vs oxfmt:** no conflict in output (ran, stable). The only issue is that oxfmt must ignore the vendored directory.
- **anti-slop vs React/OpenTUI:** none found beyond `no-conditional-empty-object-spread`, which targets a common JSX-props idiom.

## 4. Recommended config (ran end to end)

With the files below, `turbo run lint format check` ran all three root tasks in the scratch repo. `format` and `check` passed (fallow accepted the JSONC config as written, exit 0 once the sample's dead code was removed), and `lint` failed only on the sample's deliberate violations: the conditional spread in `picker.tsx`, and an unused destructured prop. oxlint's `no-unused-vars` catches that prop even though fallow's `unused-component-props` exempts exported components. The manifest parser's 8 errors were fixed by moving it to zod.

**`.fallowrc.json`**. Rules that are already `error` by default are repeated so the file is self-documenting and survives default changes. `minimumVersion` makes an older binary fail loudly:

```jsonc
{
  "$schema": "./node_modules/fallow/schema.json",
  "minimumVersion": "3.28.0",
  "includeEntryExports": true,
  "ignorePatterns": ["tools/oxlint/anti-slop/**"],
  "ignoreDependencies": ["@oxlint/plugins"],
  "duplicates": { "mode": "mild", "threshold": 0.001 },
  "health": { "maxCyclomatic": 20, "maxCognitive": 15, "maxCrap": 30, "maxUnitSize": 60 },
  "rules": {
    // dead code and dependencies
    "unused-files": "error", "unused-exports": "error", "unused-types": "error",
    "private-type-leaks": "error", "unused-dependencies": "error",
    "unused-dev-dependencies": "error", "unused-optional-dependencies": "error",
    "unused-enum-members": "error", "unused-class-members": "error",
    "unresolved-imports": "error", "unlisted-dependencies": "error",
    "duplicate-exports": "error", "type-only-dependencies": "error",
    "test-only-dependencies": "error", "dev-dependencies-in-production": "error",
    "circular-dependencies": "error", "re-export-cycle": "error",
    "boundary-violation": "error",
    "unused-dependency-overrides": "error", "misconfigured-dependency-overrides": "error",
    // React graph signals
    "unused-component-props": "error", "prop-drilling": "error",
    "thin-wrapper": "error", "duplicate-prop-shape": "error",
    // suppression hygiene
    "stale-suppressions": "error", "require-suppression-reason": "error",
    // only enforced by `fallow health` / `fallow security` / `fallow flags`
    "coverage-gaps": "error", "security-sink": "error",
    "security-client-server-leak": "error", "feature-flags": "warn",
    "policy-violation": "error"
    // Vue/Svelte/Angular/Next/pnpm-catalog/CSS rules: no-ops here; set to "error" too if you want literal "all on".
  }
}
```

Notes on the choices:
- `duplicates.threshold: 0.001` is what turns clones into a failure. Without it they never fail (ran). `mode: "mild"` rather than `semantic`, because `semantic` was about 5× noisier on real code. Switch to `semantic` only if renamed copy-paste turns out to be the slop you actually see.
- `feature-flags: "warn"` because it is an inventory of flags, not a defect. At `error`, every `ENABLE_*` env check would fail `fallow flags`.
- The health numbers are the defaults, written out. They're strict already: with estimated CRAP, every untested function with cyclomatic ≥ 5 fails.
- Keep `production` unset.

**Root scripts and turbo tasks** (extends the previous research's `//#check`):

```jsonc
// package.json
"scripts": {
  "lint": "oxlint", "lint:fix": "oxlint --fix",
  "format": "oxfmt --check", "format:fix": "oxfmt",
  "check": "fallow",                                  // dead code + dupes + health; exit 1 on any error
  "check:tests": "fallow health --coverage-gaps",     // coverage-gaps gate
  "check:security": "fallow security"                 // candidates; exit 1 if any
}
// turbo.json tasks: "//#lint": {}, "//#format": {}, "//#check": {}, "//#check:tests": {}, "//#check:security": {}
```

In PR CI, `fallow audit --gate all` can be added to fail on anything in changed files. Because scilla is greenfield, the whole-repo `fallow` gate is feasible from day one, so no baseline is needed. Pin `fallow` exactly, and on Bun-only CI use `bunx --bun` (from the previous research).

**Wiring in anti-slop**:

1. Run `npx skills add dmmulroy/anti-slop --skill install-anti-slop` and let the agent install it, or run the skill's `scripts/install.mjs` directly (`node` or `bun`). It lands in `tools/oxlint/anti-slop/`. Delete `effect/` if you like, since scilla has no Effect dependency and nothing registers it.
2. Add `"@oxlint/plugins": "<exact oxlint version>"` to the root `devDependencies` and keep both packages pinned exactly (`1.85.0` today).
3. Write `tools/oxlint/anti-slop/UPSTREAM.md` recording `dmmulroy/anti-slop@c44ef22` (or whatever commit is copied) and any local changes. This is the skill's step 5, and it's needed for the documented update procedure because upstream tags lag `main`.
4. In `.oxlintrc.json` (JSON works):

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["typescript", "unicorn", "oxc", "react", "import"],
  "categories": { "correctness": "error", "suspicious": "error", "perf": "error" },
  "env": { "builtin": true },
  "ignorePatterns": ["**/dist/**", ".agents/**", ".claude/**", "tools/oxlint/anti-slop/**"],
  "jsPlugins": [{ "name": "anti-slop", "specifier": "./tools/oxlint/anti-slop/index.ts" }],
  "rules": {
    "react/react-in-jsx-scope": "off",
    "unicorn/catch-error-name": ["error", { "name": "cause" }],
    "oxc/no-accumulating-spread": "error",
    "anti-slop/no-array-filter-map": "error",
    "anti-slop/no-reduce-accumulator-copy": "error",
    "anti-slop/no-chained-type-assertions": "error",
    "anti-slop/no-conditional-empty-object-spread": "error",
    "anti-slop/no-known-value-widening": "error",
    "anti-slop/no-module-mocking": "error",
    "anti-slop/no-object-parameters": "error",
    "anti-slop/no-reflect-apply": "error",
    "anti-slop/no-reflect-get": "error",
    "anti-slop/no-runtime-typeof": "error",
    "anti-slop/no-shape-in-symbol-names": "error",
    "anti-slop/no-unknown-parameters": "error",
    "anti-slop/no-unknown-returns": "error",
    "anti-slop/no-unknown-type-aliases": "error",
    "anti-slop/no-unsafe-dictionary-type": "error",
    "anti-slop/no-widen-then-assert": "error",
    "anti-slop/require-readable-spacing": "error",
    "anti-slop/require-safety-comment-for-type-assertion": "error"
  }
}
```

   `unicorn/catch-error-name` is only needed if `style` rules get switched on. Here it's set explicitly so that catch parameters become `cause` everywhere, which satisfies anti-slop. `suspicious` is raised from `warn` (previous research) to `error` for strictness; that raised nothing new on the sample.
5. Add `"tools/oxlint/anti-slop/**"`, `".agents/**"` and `".claude/**"` to `.oxfmtrc.json` `ignorePatterns`, and the fallow entries shown above.
6. Optionally add `"type": "module"` to the root `package.json` to silence Node's typeless-module warning. It isn't needed under `bunx --bun`.

## Facts for Stack and distribution (no decisions)

- anti-slop is Oxlint-native (a JS plugin, alpha API, vendored TS source, MIT, about 6 weeks old, one main author, latest tag `v0.1.2` behind `main` `c44ef22`). No ESLint or Biome is needed, and it ran on oxlint 1.85.0 under Bun. The npm name `oxlint-plugin-anti-slop` is squatted by an unrelated publisher.
- anti-slop's real cost is design, not tooling. `no-runtime-typeof`, `no-unknown-*` and `no-unsafe-dictionary-type` effectively require a schema library (zod passed; valibot or Effect Schema would too) at every boundary scilla parses: `scilla.json`, the lock file, SKILL.md frontmatter and git output. Assertions need `// SAFETY:` comments. Its mocking ban doesn't see `bun:test`'s `mock.module`.
- A strict fallow gate is workable with four adjustments: exclude the vendored plugin and ignore `@oxlint/plugins`; set `duplicates.threshold > 0`, because clones don't fail otherwise; run `fallow health --coverage-gaps` and `fallow security` as separate tasks, because bare `fallow` doesn't enforce those rules; and suppress `coverage-gaps` on the bin entry with a reasoned file comment. The strictest parts in practice are estimated CRAP (untested cc ≥ 5 fails, and Bun can't emit the Istanbul coverage that would refine it), `includeEntryExports` on barrels, and `private-type-leaks` on component props.
- The only oxlint-vs-anti-slop contradictions come from the `style` category (`unicorn/catch-error-name`, `unicorn/prefer-reflect-apply`). With oxlint at correctness+suspicious+perf there are none. Enabling every oxlint category is unworkable on its own terms, since its restriction rules contradict each other.
