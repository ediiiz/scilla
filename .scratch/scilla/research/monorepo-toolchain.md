# Monorepo toolchain: Turborepo on Bun, oxlint, oxfmt, fallow

Research for [issue 10](../issues/10-monorepo-toolchain.md). Date: 2026-09-22.

## Sources

- npm registry metadata (`npm view`), read on 2026-09-22:
  - `turbo` 2.11.2, `repository` `vercel/turborepo`, maintained by Vercel release bots. <https://www.npmjs.com/package/turbo>
  - `oxlint` 1.85.0 (published 2026-09-21; 1.0.0 was 2025-06-10), `engines.node ^20.19.0 || >=22.12.0`, repo `oxc-project/oxc`. <https://www.npmjs.com/package/oxlint>
  - `oxfmt` 0.70.0 (published 2026-09-21; 0.1.0 was 2025-09-12), same engines and repo. <https://www.npmjs.com/package/oxfmt>
  - `oxlint-tsgolint` 7.0.2002 (type-aware linting backend).
  - `fallow` 3.28.0 (published 2026-09-22; package created 2026-03-17; 2.0.0 on 2026-03-25, 3.0.0 on 2026-07-04; 225 versions), MIT, `engines.node >=22`, repo `fallow-rs/fallow`, npm maintainer `bartwaardenburg`. <https://www.npmjs.com/package/fallow>
- Turborepo docs (turborepo.dev, fetched as `.md` from the `llms.txt` index on 2026-09-22): `docs/guides/tools/oxc`, `docs/crafting-your-repository/configuring-tasks`, `docs/crafting-your-repository/structuring-a-repository`, `docs/core-concepts/internal-packages`, `docs/guides/publishing-libraries`, `docs/reference/prune`.
- Oxc website source: <https://github.com/oxc-project/website>, commit `15bb6c0` (2026-09-21). `WEB` = `src/docs/guide/usage/`. Blog posts `src/blog/2025-06-10-oxlint-stable.md`, `2026-02-24-oxfmt-beta.md`, `2026-07-22-type-aware-linting-stable.md`.
- fallow source: <https://github.com/fallow-rs/fallow>, commit `2c13513` (2026-09-22). `FSRC` = that tree. README, `crates/core/src/plugins/*.rs`, `crates/config/src/workspace/`, `docs/backwards-compatibility.md`. Docs: <https://docs.fallow.tools/configuration/workspaces.md>.
- Bun docs: <https://bun.com/docs/pm/cli/publish.md>, <https://bun.com/docs/pm/isolated-installs.md>, <https://bun.com/docs/bundler.md>.
- **Experiment (actually run)**: a throwaway monorepo in the session scratchpad with Bun 1.4.2, turbo 2.11.2, oxlint 1.85.0, oxfmt 0.70.0, fallow 3.28.0, `@opentui/core`/`@opentui/react` 0.5.12, TypeScript 7.0.2. The layout was a root `package.json` (`workspaces: ["packages/*"]`, `packageManager: bun@1.4.2`), `packages/core` (`@scilla/core`, private, `exports` → `./src/index.ts`) and `packages/cli` (`scilla`, bin → `dist/index.js`, `@scilla/core: workspace:*` as a devDependency, `.tsx` using `jsxImportSource: "@opentui/react"`). Everything marked "ran" below comes from it. Everything else is from reading.

## 1. Turborepo on Bun workspaces

**Support is first-class.** The Turborepo docs show a Bun tab everywhere: `bunx create-turbo@latest`, `bun.lock` as the lockfile, and a root `package.json` with `workspaces` plus `devEngines.packageManager: { name: "bun" }` (structuring-a-repository). Turbo reads the lockfile to learn the internal package graph ("Package manager lockfile" section of the same page).

What I ran:
- `bun install` wrote a text `bun.lock`. `turbo run build lint` found both workspaces and ran them. The second run was a full cache hit (`>>> FULL TURBO`, 9 ms).
- `turbo prune scilla` produced `out/` with the pruned `bun.lock`, both packages and the root manifest. `bun install --frozen-lockfile` inside `out/` succeeded. `turbo prune --production` goes further for Bun: it removes workspaces reachable only through `devDependencies` from both the manifests and the lockfile, so the frozen install still works (reference/prune).
- The `packageManager: "bun@1.4.2"` field was enough. The docs now show `devEngines.packageManager` instead, and both are accepted.

**Bun detail that matters to every tool below:** since Bun 1.3.2, new workspace projects default to the **isolated linker** (`configVersion = 1` in `bun.lock`). Packages live in `node_modules/.bun/<name>@<ver>`, and each workspace gets its own `node_modules` with symlinks (bun isolated-installs doc). In the experiment `@scilla/core` appeared under `packages/cli/node_modules/@scilla`, not in the root `node_modules`. Turbo, oxlint, oxfmt and fallow all handled this layout (see below).

**Recommended `turbo.json` shape** (the current schema uses `tasks`, not the old `pipeline`):

```jsonc
{
  "$schema": "https://turborepo.dev/schema.json",
  "tasks": {
    "build":     { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "typecheck": { "dependsOn": ["^typecheck"] },  // or a "transit" node, see below
    "test":      { "dependsOn": ["^build"] },
    "//#lint":   {},
    "//#format": {},
    "//#check":  {},                                // fallow
    "//#format:fix": { "cache": false },
    "//#lint:fix":   { "cache": false }
  }
}
```

- `^task` means "the same task in my dependencies first". A `pkg#task` key targets one package. A `//#task` key is a **Root Task**: a script in the root `package.json` (configuring-tasks, "Registering Root Tasks"). The docs name "linting and formatting" and "scripts without a package scope" as the use cases.
- Tasks like typecheck, which only need their dependencies' *source* to be current, can use a **Transit Node** (`"transit": { "dependsOn": ["^transit"] }`, `"typecheck": { "dependsOn": ["transit"] }`). The tasks then run in parallel but still re-run when an internal dependency changes (configuring-tasks, "Transit Nodes").
- Ran: a root task's hash inputs are **all git-tracked files in the repo**. `turbo run lint --dry=json` listed `packages/cli/src/*.tsx` as inputs to `//#lint`, and editing `packages/core/src/index.ts` caused a cache miss. So root lint/format/check tasks invalidate correctly. The cost: any change anywhere re-runs them, and so does a version bump of the tool or a config change. The oxc guide calls this out as an accepted tradeoff.

**Internal packages.** Turborepo's docs describe "Just-in-Time" internal packages, whose `exports` point straight at `.ts` source with no build step, as valid when the consumer bundles or runs TS natively. The tradeoff is that turbo cannot cache a build for them (internal-packages). Bun runs TS natively and `bun build` bundles it, so `@scilla/*` libraries can be JIT packages. Only the published CLI needs a `build`.

## 2. oxlint

- **Version and maturity:** 1.85.0. Stable since 1.0 (2025-06-10, blog `2025-06-10-oxlint-stable`). Releases come roughly weekly: 1.83 → 1.85 in one week. Type-aware linting (via the Go `oxlint-tsgolint` backend on typescript-go) was declared **stable** on 2026-07-22 and covers 59 of 61 typescript-eslint type-aware rules (`WEB/linter/type-aware.md`).
- **Config:** `.oxlintrc.json` (with `$schema: ./node_modules/oxlint/configuration_schema.json`), also `oxlint.json` or a TS `oxlint.config.ts` with `defineConfig` (`WEB/linter/config.md`). Configs can be nested per directory and support `extends` for a shared base (`WEB/linter/nested-config.md`). `options.typeAware` may only be set in the root config (type-aware.md).
- **TS/JSX/React:** TypeScript and TSX are parsed natively. Plugins are enabled by name: `typescript`, `unicorn`, `oxc`, `react` (covers eslint-plugin-react, react-hooks, react-refresh, plus experimental React Compiler rules), `jsx-a11y`, `import`, etc. (`WEB/linter/plugins.md`).
- **Ignores:** `.git`, minified files and anything matched by `.gitignore` are skipped by default. **`node_modules` is not special-cased beyond `.gitignore`**. Ran: before I added a `.gitignore`, oxlint linted `node_modules/.bun/diff@9.0.0/...`. Commit a `.gitignore` (or set `ignorePatterns`) before the first run (`WEB/linter/ignore-files.md`).
- `oxlint --init` (ran) writes `plugins: ["typescript","unicorn","oxc"]`, `categories: { correctness: "error" }`, `env: { builtin: true }`.

## 3. oxfmt

- **Version and maturity:** 0.70.0, still **0.x / beta**. Alpha came out on 2025-12-01 and beta on 2026-02-24, and "stable" is still listed as future work (blog `2026-02-24-oxfmt-beta.md`). The docs claim it passes 100% of Prettier's JS/TS conformance tests, and any divergence from Prettier is a bug (`WEB/formatter.md`). Adopters listed there include vuejs/core and vercel/turborepo itself.
- Turborepo's own oxc guide still has a callout saying "oxfmt is currently in alpha". That is **stale** compared with oxc's beta announcement.
- **Config:** `.oxfmtrc.json`, `.oxfmtrc.jsonc`, `oxfmt.config.ts` or `oxfmt.config.mts`, one per directory. The nearest config wins, and `--disable-nested-config` or `-c` turns that off. Prettier-style keys (`printWidth`, default **100**; `tabWidth`, `useTabs`, `semi`, `singleQuote`, `trailingComma` default `all`) plus `ignorePatterns`. Import sorting, Tailwind class sorting and package.json field sorting are built in but opt-in (`WEB/formatter/config.md`, `sorting.md`). `oxfmt --migrate=prettier` exists.
- **Languages:** JS, JSX, TS, TSX, JSON/JSONC/JSON5, YAML, TOML, Markdown, CSS and more. Some formats are delegated to a **bundled Prettier**, so no separate install is needed. The *standalone binary* skips those formats and TS configs, so install it from npm (`WEB/formatter/quickstart.md`, `language-support.md`).
- Ran: `oxfmt --init` wrote `{ "$schema": "./node_modules/oxfmt/configuration_schema.json", "ignorePatterns": [] }`. `oxfmt --check` flagged the hand-written `package.json`/`tsconfig.json`/`.tsx` files. After `oxfmt`, the OpenTUI TSX (`<box flexDirection=... focused>`, `<scrollbox stickyScroll />`) was formatted Prettier-style with no problems. It respected `.gitignore` and did not touch `node_modules`.

### Per package or root?

Turborepo's oxc guide (`docs/guides/tools/oxc`) recommends **Root Tasks** for both tools, because they are "extraordinarily fast": root scripts `"lint": "oxlint ."` and `"format": "oxfmt --check"`, registered as `//#lint` and `//#format`, with `cache: false` on the `:fix` variants. The documented tradeoff is that a tool upgrade or config change misses the cache for the whole repo. The guide's caveat: with **type-aware** oxlint, compiled internal packages must be built first (`turbo run build --filter=./packages/* && turbo run lint`), or you switch to per-package lint tasks with `dependsOn: ["^build"]`. oxc's type-aware doc says the same about needing `.d.ts` for dependents. With JIT `@scilla/*` packages that export `.ts` source, there is nothing to build first, so root-level type-aware lint would still work. I did not run type-aware mode.

## 4. fallow: what it is

**It is unambiguous.** npm has exactly one `fallow` package, plus its `@fallow-cli/*` platform binaries and sidecars. On GitHub, `fallow-rs/fallow` (4.8k stars, created 2026-03-17, pushed 2026-09-22) is the only JS/TS tool among the top "fallow" repos. The others are unrelated projects (a weed detector, a Vue demo, a game jam entry). There is no competing candidate.

- **What:** "Codebase intelligence for TypeScript and JavaScript". It is a single Rust binary, built on oxc's parser (its oxlint plugin imports `oxc_ast`), that finds unused files, exports, types, enum/class members and dependencies, circular dependencies, duplication, complexity hotspots with a 0–100 health score, architecture-boundary violations and CSS drift. It also has a changed-files PR gate (`fallow audit`) and `fallow fix` (README). It is the same category as **knip** (dead code) plus **jscpd** (duplication), and `fallow migrate` converts knip and jscpd configs. Static analysis needs no Node.js or TypeScript compiler. An optional `--type-aware` sidecar (`fallow-type-aware`, typescript-go) refines results. It states that it does not replace `tsc --noEmit` or oxlint (README, "Optional TypeScript semantic evidence").
- **Maintainer:** Bart Waardenburg (`bartwaardenburg` on npm, about 3,400 of the commits; the next human contributor has 42), under the `fallow-rs` org. MIT. There is an optional **paid** layer, "Fallow Runtime" (production coverage evidence), plus a cloud GitHub App for PR comments. Everything used for static checks is free (README, "Runtime intelligence").
- **Cadence risk:** 225 npm versions in about 6 months, two major versions (2.0 in March, 3.0 in July), and minors every couple of days. `docs/backwards-compatibility.md` records behaviour changes, for example the one below.
- **Config:** `.fallowrc.json` (JSONC ok) > `.fallowrc.jsonc` > `fallow.toml` > `.fallow.toml`, first match per directory with no merging. `$schema: ./node_modules/fallow/schema.json`. Keys include `entry`, `ignorePatterns`, `ignoreDependencies`, `ignoreExports`, `includeEntryExports`, `publicPackages`, `rules` (`error`/`warn`/`off`), `workspaces`, `boundaries`, `production`, `audit`. `fallow recommend` proposes a config, `fallow init` scaffolds one, `fallow doctor` and `fallow workspaces` diagnose (README).
- **Monorepos:** it auto-detects `package.json` `workspaces`, `pnpm-workspace.yaml` and `deno.json`. It resolves cross-package imports through `node_modules` symlinks back to source and maps `dist/*` exports back to `src/*` (docs `configuration/workspaces`). Bun isn't named in that page, but the source has Bun-specific handling: a `bun` plugin (`bunfig.toml`, `bun test` patterns, `@types/bun`) and `bun.lock` override parsing (`FSRC/crates/core/src/plugins/bun.rs`, `FSRC/crates/config/src/workspace/npm_overrides.rs`). It also has built-in plugins for **turborepo** (`turbo.json` always used, `turbo` counts as a tooling dependency), **oxlint** (`.oxlintrc.json`/`oxlint.config.ts`, `oxlint-tsgolint`), **oxfmt** and **typescript**. The typescript plugin reads `compilerOptions.jsxImportSource` (`FSRC/crates/core/src/plugins/typescript.rs:127`), so `@opentui/react` counts as used via the JSX runtime.
- **CI:** `npx fallow` (full pipeline) or `npx fallow audit` (only findings the PR introduced) as a gate. Exit codes: 0 means clean, 1 means findings, 2 means error. Output formats: `--format json|sarif|compact|github-annotations|codeclimate|...`. The GitHub Action is `uses: fallow-rs/fallow@v3` with `fetch-depth: 0`. It installs the CLI version pinned in `package.json`, so **pin an exact version**. It fails on any finding by default, and `command: audit` or `fail-on-issues: false` suit a staged rollout (README "CI").

### What I ran with fallow

- `bunx fallow` on the scratch repo ran in about 30 ms. Active plugins were oxfmt, oxlint, typescript, turborepo and bun. It found both workspaces (`@scilla/core` flagged as an "internal dep") and resolved the `@scilla/core` import through Bun's isolated `node_modules/.bun` layout (fan-in 1). It mapped the CLI's `bin: ./dist/index.js` back to `src/index.tsx`. It did **not** flag any root devDependency (turbo, oxlint, oxfmt, fallow, typescript, @types/bun) or the OpenTUI/React deps. It did flag a new unimported `app.tsx` as an unused file.
- **Gotcha:** an unused export in `@scilla/core` was **not reported by default**, because the package's `exports` target (`src/index.ts`) counts as a package entry point and entry-point exports are exempt. Adding `"includeEntryExports": true` (or `--include-entry-exports`) reported it. For internal-only `@scilla/*` libraries, where every export should have a consumer inside the repo, that flag is the useful setting. (`docs/backwards-compatibility.md` notes that since #2210, workspace exports are only treated as *public API* when listed in `publicPackages`. The exemption I hit was the plain entry-point one.)
- A harmless WARN: fallow tried to treat a path in a package script (`tsc -p ../../tsconfig.json`) as an entry point and skipped it because it lies outside the package.
- It writes a cache to `.fallow/`, which ships its own `.gitignore` of `*`.
- **Runtime:** fallow's, oxlint's and oxfmt's npm launchers all have a `#!/usr/bin/env node` shebang (`engines.node >=22` for fallow). Under plain `bunx`, Node is used when present. I ran all three with `bunx --bun`, which forces Bun, and they worked: the launcher only spawns the native binary. So a Bun-only CI image is fine, but use `bunx --bun` or `bun --bun run` there.

## 5. Publishing a CLI that depends on internal `@scilla/*` packages

Two patterns exist:

1. **Bundle internals into one artifact (fits scilla).** The published `scilla` package runs `bun build ./src/index.tsx --target bun --outdir dist` and marks OpenTUI and React as `--external` (they carry native optional deps and must stay real dependencies). Internal `@scilla/*` packages go in **`devDependencies`** with `workspace:*`, so they are inlined and never needed at install time.
   - Ran: the bundle inlined `@scilla/core` and tree-shook its unused export, with `import ... from "@opentui/core"`, `"@opentui/react"` and `"@opentui/react/jsx-runtime"` left external. The shebang was preserved (`#!/usr/bin/env bun` plus a `// @bun` pragma).
   - **Gotcha (ran):** without `--production`, `bun build` emitted `jsxDEV` from **`@opentui/react/jsx-dev-runtime`**. With `--production` (sets `NODE_ENV=production` and minifies, per the bun bundler doc) it emitted `jsx` from `jsx-runtime`. Use `--production`, or `--define process.env.NODE_ENV='"production"'` if you don't want minification.
   - Turbo side: `build` with `dependsOn: ["^build"]` and `outputs: ["dist/**"]`. JIT internal packages have no build step, so this reduces to the CLI's own build.
2. **Publish each package.** Every `@scilla/*` package becomes public, gets its own build and versioning, and usually uses Changesets (Turborepo's publishing-libraries guide, which uses tsup plus Changesets). This is only worth it if the libraries have external consumers.

**How `workspace:*` is handled:** `bun publish` "strips catalog and workspace protocols from the `package.json`, resolving versions if necessary" (bun publish doc). Ran: `bun pm pack` turned `"@scilla/core": "workspace:*"` into `"0.0.0"` (the workspace's version) in the tarball's `package.json`. If an internal package were left in `dependencies` while being `private` and unpublished, users' installs would fail. That is why internals go in `devDependencies` when they are bundled. `files: ["dist"]` kept the tarball to `package.json` plus `dist/index.js`. Publish with `bun publish` (or `bun pm pack`, then publish the tarball), because the rewrite is Bun's feature. I did not test whether `npm publish` would rewrite the specifiers.

## 6. Conflicts with OpenTUI's React/JSX setup

The TSX setup is `tsconfig` `"jsx": "react-jsx"`, `"jsxImportSource": "@opentui/react"`, with lowercase intrinsics such as `<box>`, `<text>` and `<scrollbox>` that take non-DOM props.

- **oxlint (ran), two rules conflict:**
  - `react/react-in-jsx-scope` is in the **suspicious** category. When `react` plus `suspicious` are enabled, it fires on every JSX element. Oxlint does not read tsconfig's `jsx` setting to suppress it, and the rule's own doc says to disable it under the automatic runtime (`WEB/linter/rules/react/react-in-jsx-scope.md`). Set it to `"off"`.
  - `react/no-unknown-property` (category **restriction**, off unless you opt in) flags OpenTUI props (`flexDirection`, `borderStyle`, `focused`, `fg`, `stickyScroll`) as unknown DOM attributes. Leave it off, or list the props in its `ignore` option. `jsx-a11y` is meaningless for a terminal UI, so don't enable it.
  - `react/jsx-key` (correctness) and the hooks rules work as they would in React DOM.
- **oxfmt (ran):** no issues. It formats JSX syntactically and does not care about the runtime.
- **fallow (read and ran):** it reads `jsxImportSource`, so the JSX runtime package isn't reported as unused. It reported no false positives on the OpenTUI deps.
- **turbo:** not involved.
- **Bundling:** the only JSX-related trap was dev vs prod runtime (see section 5).

Resulting oxlint shape that passed on the OpenTUI sample (ran):

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["typescript", "unicorn", "oxc", "react", "import"],
  "categories": { "correctness": "error", "suspicious": "warn", "perf": "warn" },
  "rules": { "react/react-in-jsx-scope": "off" },
  "env": { "builtin": true },
  "ignorePatterns": ["**/dist/**"]
}
```

## Facts for Stack and distribution (no decisions)

- All four tools install and run under Bun 1.4.2 with the isolated linker. All four are native Rust binaries shipped as optional per-platform npm packages. Their launchers use a Node shebang, so run them with `bunx --bun` on Bun-only machines.
- Turbo's own docs recommend running oxlint and oxfmt as root tasks. fallow is also whole-graph by nature, since it has to see every workspace to know an export is unused, so it is a root task too. That leaves turbo per-package tasks for `build`, `typecheck` and `test` only.
- fallow is young (6 months old, one dominant maintainer, two majors so far) and moves fast. Pin exact versions of fallow and oxfmt (0.x). oxlint is 1.x and follows semver.
- Suggested root scripts: `"lint": "oxlint"`, `"format": "oxfmt --check"`, `"format:fix": "oxfmt"`, `"check": "fallow"` (or `fallow audit` in PRs). Suggested `.fallowrc.json`: `{ "$schema": "./node_modules/fallow/schema.json", "includeEntryExports": true }`.
