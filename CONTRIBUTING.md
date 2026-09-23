# Contributing to scilla

Thanks for helping. This page covers what you need before your first PR.

## Setup

You need [Bun](https://bun.sh) 1.4.2 (the version pinned in `packageManager`) and `git`.

```sh
bun install
bun run verify   # everything CI runs; it must pass before you open a PR
bunx skills experimental_install   # optional: restore the repo's agent skills from skills-lock.json
```

Try your changes against the real CLI:

```sh
bun run build
bun apps/cli/dist/index.js --help
bun apps/cli/src/index.ts add ./some/local/collection   # run from source, no build step
```

## Repo layout

| Path            | Package                  | What goes there                                                   |
| --------------- | ------------------------ | ----------------------------------------------------------------- |
| `apps/cli`      | `scilla-cli` (published) | Argument parsing, commands, output, `docs/*.md` for `scilla docs` |
| `packages/core` | `@scilla/core` (private) | Sources, git, Traversal, install, locks, audit. **No UI.**        |
| `packages/tui`  | `@scilla/tui` (private)  | The picker, preview and home screen (OpenTUI + tuiparts)          |

`@scilla/*` are never published; the CLI bundles them. Keep logic in `core`, rendering in `tui`, and glue in `apps/cli`.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org): `type(scope): summary`, written in the imperative, lower case, with no trailing period.

| Prefix     | Use it for                                                     |
| ---------- | -------------------------------------------------------------- |
| `feat`     | New behaviour users can see (a command, flag, picker feature)  |
| `fix`      | A bug fix                                                      |
| `docs`     | README, CONTRIBUTING, `scilla docs` topics, code comments only |
| `refactor` | A code change that changes no behaviour                        |
| `perf`     | Faster or leaner, with the same behaviour                      |
| `test`     | Tests only                                                     |
| `build`    | Bundling, dependencies, `package.json`, turbo                  |
| `ci`       | GitHub workflows                                               |
| `chore`    | Anything else (tooling config, housekeeping)                   |
| `revert`   | Reverting an earlier commit                                    |

**Scopes** (optional): `core`, `tui`, `cli`, `docs`, `deps`, `release`.

**Breaking changes**: add `!` after the type or scope and a `BREAKING CHANGE:` footer that explains the migration. Examples of breaking changes: a lock or manifest format change, a renamed flag, a changed exit code.

```
feat(cli): add scilla audit command
fix(core): keep declined skills declined after an unattended update
refactor(tui)!: rename HomeAction kinds

BREAKING CHANGE: "ref-add" is now "reference-add".
```

Keep commits focused, one logical change each. PRs are squash-merged, so the PR title must follow the same format.

## Changesets (release notes)

Any PR that changes what users of `scilla-cli` see needs a changeset:

```sh
bun changeset
```

Pick `scilla-cli` and a bump (`patch` for fixes, `minor` for features, `major` for breaking changes while ≥1.0), then write one or two sentences for users. Docs-only, test-only and CI-only PRs don't need one. Releases themselves are automated; see [`docs/releasing.md`](docs/releasing.md).

## Code rules

The checks enforce most of these, and CI fails when any is broken. Don't silence a check: no `oxlint-disable`, `fallow-ignore` or `@ts-expect-error`, and don't loosen the configs. If a finding really is a false positive, say so in the PR and use a targeted ignore with a specific reason.

**TypeScript**: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. Use `.ts` import extensions.

**Linting (oxlint + [anti-slop](https://github.com/dmmulroy/anti-slop))**:

- Validate I/O with **zod** instead of `typeof` checks (manifests, locks, frontmatter, HTTP responses, CLI args).
- No `unknown` parameters, except for a caught `cause`.
- Every `as` cast needs a `// SAFETY:` comment explaining why it holds. Better still, avoid the cast.
- Name catch parameters `cause`.
- No conditional empty-object spreads (`...(x ? {a} : {})`). Set `a: x`, which JSON drops when it's undefined.
- Use `flatMap` instead of `.filter().map()`.
- No `await` inside loops. Use `Promise.all`, or `reduce` over promises when order matters.
- Separate statement groups with blank lines.
- `tools/oxlint/anti-slop` is vendored upstream code. Never edit it (see `UPSTREAM.md` there).

**Formatting**: oxfmt. Run `bun run format:fix`.

**fallow (strict)**:

- No unused files, exports or dependencies. Entry exports count too, so don't export "just in case".
- No duplicated code.
- Each function stays within cyclomatic complexity 20, cognitive 15, 60 lines, and CRAP 30. The CRAP limit means an untested function that has any branching fails, so write the test.
- Every file and export must be exercised by a test (`bun run check:tests`).
- `bun run check:security` must stay clean.

## Tests

- Use `bun test`, with the test file next to its source (`foo.ts` → `foo.test.ts`).
- **No network, ever.** Use local git fixture repos over `file://` (see `packages/core/src/testing/fixtures.ts` and `apps/cli/src/testing/harness.ts`), inject `fetch` for audit code, or set `SCILLA_NO_AUDIT=1`.
- **Never touch the real home directory or git config.** Use a temp `SCILLA_CACHE_DIR` and `SCILLA_HOME`, plus `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_NOSYSTEM=1`. Clean up temp dirs with `afterAll(cleanup)`.
- Test TUI components headlessly with OpenTUI's `testRender` (see `packages/tui/src/test-render.ts`). Put pure logic in `*-model.ts` files and unit-test it there.
- Fix a bug by writing the failing test first.

## Docs

- **`CONTEXT.md`** is the domain vocabulary: Collection, Manifest, Own Skill, Reference, Nested Collection, Traversal, Pin, Curator, Consumer. Use these words in code, output and docs, and avoid the synonyms it lists. When you add a new concept, add it there first.
- **`apps/cli/docs/*.md`** is what `scilla docs` prints, for both people and AI agents. Drift tests fail if a command, flag, schema field or `CONTEXT.md` term goes missing, so update the matching topic in the same PR.
- **`README.md`**: update it when user-facing behaviour changes.
- Record decisions that are hard to reverse, or that a future reader would question, as ADRs in `docs/adr/` (create the folder with the first one).

## Design constraints worth knowing

- **Compatibility with the [`skills`](https://github.com/vercel-labs/skills) CLI**: install to `.agents/skills/<name>` with relative symlinks into `.claude/skills`, keep `skills-lock.json` in sync, and use the same `computedHash` algorithm. Don't break this without discussing it first.
- **Fetching goes through the user's own `git`**, which is how private repos work. Don't add a git library or GitHub tokens.
- **The lock format is a public contract.** If you change `scilla-lock.json` or `scilla.json`, you must migrate older files on read and mark the change as breaking.
- **Privacy**: never send private repo names or local paths to any service. The audit only queries repos GitHub confirms are public, and honours `DO_NOT_TRACK`, `DISABLE_TELEMETRY` and `SCILLA_NO_AUDIT`.
- **Scripted use**: every command must work without a TTY (`-y`). Warnings go to stderr as `warning: …`, errors print `error: …` and exit 1.

## Reporting issues

For bugs, include `scilla --version`, `bun --version`, your OS, the exact command, and the output with `SCILLA_DEBUG=1`. **Report security issues privately** through GitHub's "Report a vulnerability" on [ediiiz/scilla](https://github.com/ediiiz/scilla/security), not as a public issue.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
