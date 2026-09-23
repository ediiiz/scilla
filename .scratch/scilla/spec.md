# Scilla v1 spec

Status: building (2026-09-22). The user stopped planning after Collection manifest format and asked to build v1. They delegated every remaining decision, and this file records them. Decided tickets: [map](map.md). Vocabulary: [CONTEXT.md](../../CONTEXT.md).

## Collection manifest

As in [Collection manifest format](issues/04-collection-manifest-format.md): `scilla.json` at the repo root, JSON with `$schema`.

- The manifest JSON Schema (`manifestJsonSchema()` in core) ships in the package as `dist/scilla.schema.json`, emitted by the CLI's build step (`apps/cli/scripts/emit-schema.ts`).
- `scilla init` writes `"$schema": "https://unpkg.com/scilla-cli/dist/scilla.schema.json"` as the first key. `$schema` stays optional: hand-written manifests without it are valid.

## Sources (Reference shorthand)

- `owner/repo[/path][@name][#ref]`: GitHub, fetched from `https://github.com/owner/repo.git`.
- Any git URL (`https://…`, `ssh://…`, `git@…`, `file://…`, or ending in `.git`) `[#ref]`; the path goes in the object's `path` field.
- A github.com https URL (`https://github.com/owner/repo`, with or without `.git` and a trailing slash) is kind `github` with the canonical URL, so it has the shorthand's key (`owner/repo`), is audited, and is mirrored to skills-lock.json as GitHub. `git@github.com:owner/repo.git` stays kind `git` and is fetched over SSH: the user chose SSH on purpose.
- A github.com page link: `https://github.com/o/r/tree/<ref>[/<path>]` is that folder, `…/blob/<ref>/<path>/SKILL.md` is the folder holding that SKILL.md (a blob link to any other file is a `SourceError`). Kind `github`, with the path and `<ref>` as the Pin, except `main` and `master`, which float (no Pin): offline, scilla can't know the default branch, and those two nearly always are it. The ref is assumed to be one segment, since a branch with `/` is ambiguous with the path. `?query` and `#anchor` are ignored. `scilla ref add` stores the shorthand (`formatSource`), not the URL.
- A local directory (`./x`, `../x`, `/abs`, `~/x`). It's read from the working tree without git (commit `local`). Useful for Curators and tests.
- Identity of a fetched repo = its canonical git URL.

## Traversal

- **Target**: the source's repo at the resolved commit, narrowed to `path`.
  - If the target dir holds `scilla.json`, it's a **Nested Collection**.
  - If it holds `SKILL.md`, it's a single skill.
  - Otherwise it's a plain skills folder that gets scanned.
- **Discovery (scan)**: walk the tree to depth 6 and stop descending at a dir with `SKILL.md`. Skip `.git`, `node_modules` and every dot-dir except `.curated`, `.experimental` and `.system`, which covers installed-copy dirs like `.agents` and `.claude`. Results are sorted by path.
  - Deviation from the manifest ticket: there's no separate skip rule for skills listed in the scanned repo's `skills-lock.json`. The installed copies it lists already live in skipped dot-dirs.
- **Skill metadata**: parsed leniently from SKILL.md frontmatter. `name` falls back to the dir name, and `description` falls back to empty.
- **Filters**: `@name`, then `include`, then `exclude`, all matched against names. They apply to the flat output of the Reference, including a Nested Collection's full output.
- **Optional marking**: a skill is optional if any level marks it optional: the Reference's `optional: true`, or a manifest's `optional` globs on the way down.
- **Diamond**: the same skill identity (URL + skill path + commit) reached twice is kept once.
- **Collisions**: two different skills with the same name within one manifest's output.
  - If both come directly from that manifest (Own Skills or a plain Reference), Traversal fails.
  - If either arrives through a Nested Collection, the first one in manifest order wins (Own Skills first), with a warning.
  - Conflicting Pins for the same repo count as different identities, so the same collision rule applies.
- **Cycles**: a Collection already on the current path (same URL + path) is skipped with a warning. Nesting is capped at depth 8.
- **Errors**: a Reference that fails to fetch or resolve becomes a warning, and its skills are missing. The root Collection failing is fatal. Bad `scilla.json` anywhere is fatal, since it's the Curator's bug.
- **Picker grouping**: each skill carries the chain of labels it came through (Collection name, then Reference source). The picker groups by the first level below the root.

## Fetching and cache

- Shell out to `git`, so the user's credentials apply.
- Mirror clones live in `$SCILLA_CACHE_DIR`, or `$XDG_CACHE_HOME/scilla`, or `~/.cache/scilla`, under `repos/<sha256(url)>` (its first 32 hex digits). Each is fetched at most once per run. Empty or blank path variables (`SCILLA_CACHE_DIR`, `XDG_CACHE_HOME`, `SCILLA_HOME`) count as unset (`envValue` in core), so they never mean the cwd.
- `repos/` and `checkouts/` each hold a `CACHEDIR.TAG` ([Cache Directory Tagging](https://bford.info/cachedir/)), written on every run so older caches get one too. Discovery never descends into a folder holding a `CACHEDIR.TAG` (the scan root itself excepted), so a cache that ends up inside a Collection's folder can't leak skills into it. The tag goes in those subfolders, not the cache root, so a cache root that is a project dir doesn't hide the project from backups.
- For each commit a checkout is made with `git clone --shared` + `checkout --detach` under `checkouts/<sha256(url)>/<commit>` and reused.
- A fetch failure with an existing mirror warns and uses the cache (offline mode).
- Git failures are reported in one line: the first `fatal:` line of git's stderr (the specific one, e.g. "does not appear to be a git repository", rather than the generic "Could not read from remote repository." that follows it), or else its first non-empty line. The full stderr rides along as the error's (or warning's) `detail` and is printed, indented, only when `SCILLA_DEBUG` is set.
- A Pin is any git ref, resolved with `rev-parse <ref>^{commit}`. With no Pin, `HEAD` of the default branch is used.

## Install and lock

- **Fetched Collections and local paths**: inside a fetched Collection, `./x` resolves to the same repo and commit. Absolute paths, `~` and `..` escapes are refused with a warning. A Reference source that doesn't parse is a Traversal warning, not a fatal error.

- **Scope**: project = cwd; `--global` = the home directory.
- **Files**: copied to `<base>/.agents/skills/<name>/`. A relative symlink `<base>/.claude/skills/<name>` is added when `<base>/.claude` exists. This is the same layout as the `skills` CLI.
- **`scilla-lock.json`** at the project root, or `~/.agents/scilla-lock.json` for `--global`. It's version 1, with sorted keys and no timestamps:
  - `collections[key]` (key = `formatSource`): `{ name, source: { kind, url, path, ref?, skill? }, commit, selected[], declined[] }`. The source is kept as an object because a git URL with a path has no string form that parses back. A Collection with nothing selected stays after `delete <skill>`, so the declined record survives.
  - `skills[name]`: `{ collections[], kind, url, path, commit, computedHash, optional }`
  - Migration on read: older versions stored github.com https URLs as kind `git`, keyed by the URL. `readLock` re-keys such Collections to their `formatSource` key (`owner/repo[/path][@name][#ref]`), unless that key is already taken, and turns such skills into `github`, rewriting their `collections[]`. The next write persists it. `findCollection` also finds a GitHub Collection by its https URL.
- **`skills-lock.json` compatibility**: project installs also upsert `skills-lock.json` entries (`source`, `sourceType`, `skillPath`, `computedHash`, `sourceUrl?`), so the skills CLI sees them. No `ref` is written, because scilla's Pins live on References. A `skills-lock.json` scilla can't parse is left untouched, with a warning. `computedHash` uses the skills CLI algorithm: sha256 over path + bytes, sorted with `localeCompare`, skipping `.git` and `node_modules`.
- **Trust**: the picker shows each skill's origin (repo, path, short commit). Skills that contain executable files are flagged, and are warned about again before install.
  - A file is executable if it has the exec bit, is a shell-type script (`.sh`, `.bash`, `.zsh`, `.fish`, `.ps1`, `.bat`, `.cmd`) anywhere, is a `.js`/`.mjs`/`.cjs`/`.ts`/`.py`/`.rb` file directly under a folder named `scripts/` or `bin/`, or starts with a `#!` line. `.d.ts` (and `.d.mts`, `.d.cts`) never counts. The check is a stat plus a 2-byte read, and only when the name alone doesn't decide.
  - `ResolvedSkill.executables` stays complete. Every place that prints the list (the pre-install warning, `scilla check`, the picker's detail pane) shows at most 5 paths, then `+N more`. The preview's file tree collapses on its own.
- **Name clash with an installed skill from a different origin**: that skill is skipped with a warning.
- **Skips are warnings**: every skipped skill (local edits, name clash, a folder scilla didn't install) is printed once as `warning: Skipped <name>: <reason>` on stderr. The outcome summary (`Installed:`, `Updated:`, `Unchanged:`, `Removed:`, or `Nothing changed.`) stays on stdout and doesn't repeat skips.
- **Local edits**: if an installed folder's hash differs from the lock's `computedHash`, `update` and `delete` skip that skill with a warning; `--force` overrides.
- **Update**: re-traverse each installed Collection.
  - Selected skills that are still available are kept, and reinstalled if the hash changed.
  - Skills that are new upstream (never selected or declined) show as **new** and unticked.
  - Skills gone upstream are removed.
  - The picker opens with the kept skills ticked. With `--yes` or no TTY, only kept skills are installed and new ones are listed.
  - Only the picker records declines: a skill left unticked there becomes declined. An unattended run (`--yes` or no TTY, for `add` too) decides nothing about skills it leaves out that are new, or recommended but not installed (for example skipped for a name clash). They stay undecided, so every later update lists them again. Optional skills that an unattended `add` leaves out are recorded as declined.
- **Delete**: `delete <collection-source|collection-name>` removes that Collection's skills, except ones another Collection also installed. `delete <skill>` removes one skill and records it as declined.

## Restore from the lock (`scilla install`)

Decided in [Restore from the lock](issues/16-restore-from-lock.md).

- `scilla install [-g]` installs every entry of the lock's `skills` from its `url` and `path` at its locked `commit` (`Fetcher.checkoutCommit`), and nothing else. No Traversal, no picker, no audit; `scilla-lock.json` is not written, `skills-lock.json` is synced as on any project install. `restoreLock` in core.
- `checkoutCommit` uses a cached checkout of the commit, else a cached mirror that has it, without fetching; only then does it fetch the mirror. Only a full SHA (40 or 64 hex digits) is passed to git, because a lock is a file anyone can edit. A commit the fetched mirror lacks is `Commit abc1234 is no longer in <url>; was it force-pushed away?`.
- Each copy is hashed before it's installed; a hash other than `computedHash` fails that skill and nothing is copied.
- Per skill: installed with the locked hash → `Unchanged:`; installed with another hash → skipped as `its files differ from the lock: local edits, or another version (use --force to overwrite)` (scilla can't tell a local edit from a copy of another version once `git pull` replaced the lock); missing → `Installed:`; replaced with `--force` → `Updated:`. Failures print `error: Can't install <name>: <reason>` each; the rest continue; exit 1.
- `--check` installs nothing and reports `Missing:`, `Modified:`, `Extra:` (`checkInstalled`); exit 1 on any. Extra = a folder in `./.agents/skills` that neither `scilla-lock.json` nor `skills-lock.json` lists, so the skills CLI's installs aren't extra. `-g` reports no extras: `~/.agents/skills` is shared with tools that keep no lock there. Nothing is ever removed.
- `--frozen` runs the same comparison after the install and exits 1 on any mismatch. `--check` wins over it.
- `scilla install <source>` is a `UsageError` pointing at `scilla add <source>`, not an alias: `install` never resolves anything new, so a CI script that passes a source by mistake fails instead of changing what's installed. Making it an alias later would not break anyone; the reverse would.

## Reviewed updates

Decided in [Reviewed updates](issues/12-reviewed-updates.md).

- **Review file**: `scilla-review.json`, committed next to `scilla.json`, `{ "version": 1, "references": { "<key>": { "commit": "<full sha>" } } }`, keys sorted. The key is the Reference's label as the manifest writes it (`referenceLabel`: the source string, or `source (path)`), so editing `include`/`exclude` keeps the review and changing the source drops it. It's a separate file, not a manifest field: the manifest stays hand-written and its schema unchanged, and the review is machine-written state like a lock. Invalid → `ManifestError` (fatal, the Curator's to fix), named `scilla-review.json of <source> at <commit>` for fetched Collections.
- **Pinning**: a fetched Reference with a Review resolves to the reviewed commit for everyone (Traversal sets its `ref` to it), overriding its Pin, so changing a Pin without re-accepting changes nothing for Consumers. Local References are never reviewed (their files are part of the Collection). A Reference without an entry floats as before, so Collections without the file behave exactly as in v1. Nested Collections follow their own `scilla-review.json`. `traverse(source, fetcher, { reviewed: false })` ignores only the root's review: what accepting would release.
- `ResolvedSkill.reference`: the root Collection's Reference label a skill came through (undefined for the root's Own Skills), to group per Reference.
- **Consumer `outdated [-g]`**: re-traverse each installed Collection and `compareInstalled` with the lock: selected skills `changed` (hash differs), `moved` (commit or origin differs, same hash), `removed`; skills never selected or declined `new`. Printed per Collection as `Name (key)  old → new` and a table (Skill, Change, Installed, Upstream), or `… at abc1234: up to date`. Exit **10** when any skill is changed, new or removed; moves alone exit 0 (a floating Collection moves on every unrelated upstream commit).
- **Consumer `diff [collection|skill] [-g] [--raw] [--no-audit]`**: per changed, new or removed skill: heading (name, change, commit move, Collection), origin, `ratings  Gen safe → medium · …` (two `auditSkills` calls, installed and upstream origins, same privacy and opt-outs; the service rates a repo as it is now, so the two differ only when the origin changed), new or changed files that can run code (highlighted), `A`/`D`/`M` files with binaries marked, then git's unified diff. The earlier version is the installed copy while it hashes to the lock, else the locked checkout (`lockedSkillDir`), so local edits never show as upstream changes. `diffSkill` copies both versions into a scratch dir as `a/` and `b/` and runs `git diff --no-index --src-prefix= --dst-prefix=`, so paths read `a/SKILL.md b/SKILL.md` relative to the skill folder for any origin (local folders too). A file is `modified` when its bytes or whether it can run code differ. Colour only on a TTY, not with `--raw` or `NO_COLOR`. A target that no Collection, Reference or skill has is an error.
- **Curator views**: in a folder with `scilla.json` and without `-g`, `outdated` and `diff` compare each fetched Reference's upstream (its Pin or the default branch) with its reviewed commit (`referenceStatuses`: `reviewed`, `outdated`, `floating`, `unreachable`), and the Collection as Consumers get it with its upstream Traversal (`compareTraversals`). `outdated` exits 10 when any reviewed Reference is `outdated`; floating ones never count.
- **`review accept [reference]`**: `acceptReview` records the upstream commit of every fetched Reference (or the one named by key or `formatSource`) and prints `Reviewed <key>: abc1234 → def5678` (`floating → …`). Unreachable References keep their entry, with a warning; entries for References the manifest no longer has are dropped. Accepting everything is how a Curator opts a Collection in.
- **`review propose [--open] [--provider p] [--title-file f] [--body-file f] [--no-audit]`**: in a git checkout of the Collection, for the `outdated` References only (floating ones are never proposed): refuse a detached HEAD or an uncommitted `scilla-review.json`; `git checkout -B scilla/review-updates`, accept, commit only `scilla-review.json` with subject `chore(review): bump the reviewed commit of <key>` (`… commits of N References`) and a body line per Reference, switch back. Title and Markdown body go to stdout (`title\n\nbody`) or the files; progress to stderr. The body: a Reference table, per Reference a skill table (change, `A`/`D`/`M` files), notes on files that can run code and ratings, then collapsed `<details>` diffs, each at most 20 000 characters and all within 60 000 (GitHub's limit is 65 536), with a closing pointer to `scilla diff`.
- **`--open`**: the forge is resolved before anything is committed: `--provider`, else `origin`'s host (`github.com`, `gitlab.com` or any host containing `gitlab`, `codeberg.org` → forgejo, `gitea.com`), else the single one of `FORGEJO_TOKEN`/`GITEA_TOKEN`/`GITLAB_TOKEN` that is set, else an error asking for `--provider`. Then `git push --force origin scilla/review-updates` and `openPullRequest` (core `forge.ts`, fetch injected):
  - GitHub: `GET /repos/{o}/{r}/pulls?state=open&head={o}:{branch}`, then `PATCH …/pulls/{n}` `{title, body}` or `POST …/pulls` `{title, body, head, base}`; `Authorization: Bearer $GITHUB_TOKEN`; base `https://api.github.com`, `$GITHUB_API_URL`, or `<origin>/api/v3`.
  - Gitea and Forgejo: the same flow on `<origin>[/<sub-path>]/api/v1/repos/{o}/{r}/pulls` (listing `?state=open&limit=50`, matched on `head.ref`); `Authorization: token …` from `GITEA_TOKEN` or `FORGEJO_TOKEN` (each provider prefers its own).
  - GitLab (optional): `GET /api/v4/projects/{path}/merge_requests?state=opened&source_branch=…`, then `PUT …/{iid}` or `POST …` `{title, description, source_branch, target_branch}`; `PRIVATE-TOKEN: $GITLAB_TOKEN` or `JOB-TOKEN: $CI_JOB_TOKEN`.
  - Remotes: https/http (credentials dropped), `ssh://` and scp-style (`https://<host>`). Responses are parsed with zod; a non-2xx answer is an error with the status and the start of the body.
- **Example workflows**: `docs/examples/scilla-review.github.yml` and `docs/examples/scilla-review.forgejo.yml` (for `.forgejo/workflows/` or `.gitea/workflows/`): weekly schedule plus `workflow_dispatch`, checkout with full history, setup-bun, a git identity, then `bunx scilla-cli review propose --open` (the Forgejo one with `--provider forgejo`). A drift test parses both and checks the command parses.
- **TUI**: `markChanged(plan, lock)` sets `Choice.changed` (optional, so older callers still build Choices) on installed choices whose upstream hash differs from the lock; the picker shows `changed` instead of `installed`. `PickOptions.diff` (optional) loads a choice's unified diff; `d` on a changed row opens the preview on "Changes since the lock" (a hint on other rows), `d` in the preview switches between SKILL.md and the changes.

## CLI surface

| Command | Does |
| --- | --- |
| `scilla` | TUI home: Consumer actions, plus Curator actions for the cwd |
| `scilla add <source> [-g] [-y] [--all] [--force] [--no-audit]` | Traverse, pick (recommended pre-ticked), show security ratings, install. `-y`/no TTY installs recommended; `--all` installs everything |
| `scilla update [collection] [-g] [-y] [--all] [--force] [--no-audit]` | See Install and lock |
| `scilla delete <collection\|skill> [-g] [--force]` (alias `remove`) | See Install and lock |
| `scilla install [-g] [--frozen] [--check] [--force]` | Install exactly what the lock records (see Restore from the lock) |
| `scilla outdated [-g]` | What an update (or, in a Collection, a review) would change; exit 10 when anything would |
| `scilla diff [collection\|skill] [-g] [--raw] [--no-audit]` | The changes, per skill (see Reviewed updates) |
| `scilla list [-g]` | Installed Collections and skills |
| `scilla audit [-g]` | Security ratings of the installed skills (see Security ratings) |
| `scilla docs [topic] [--raw]` | The bundled manual (see Docs) |
| `scilla init [--name] [--description]` | Curator: write `scilla.json` in the cwd |
| `scilla ref add <source> [--optional] [--include g] [--exclude g] [--no-verify]` | Curator: append a Reference. A local path that doesn't exist is refused. A git or GitHub source is checked with `git ls-remote --exit-code` (plus the Pin, unless it's a commit SHA); the check is killed after 10 s. If it fails it prints a warning but still adds the Reference, since the machine may be offline or lack credentials for a private repo. `--no-verify` skips the check |
| `scilla skill new <name>` | Curator: scaffold `skills/<name>/SKILL.md` |
| `scilla check [dir]` | Curator: traverse a local Collection and print the tree, warnings and collisions |
| `scilla review accept [reference]` | Curator: record upstream commits as reviewed in `scilla-review.json` |
| `scilla review propose [--open] [--provider p] [--title-file f] [--body-file f]` | Curator: commit the bumps on `scilla/review-updates`, write the PR title and body, `--open` pushes and opens or updates the PR |

Exit code 1 on error, with the message on stderr; `install` also exits 1 when a skill failed or, with `--frozen`/`--check`, on a mismatch. `outdated` exits 10 when updates are available (not an error). Commands return their exit code to `main`. `--help` and `--version` are supported; the help ends with "Docs: scilla docs (for people and agents)".

- Errors a docs topic explains end with a `see: scilla docs <topic>` line: a source that doesn't parse (`SourceError` from core) → `sources`, an invalid manifest or a collision (`ManifestError`) → `manifest`, a bad command line (the CLI's `UsageError`) → `commands`.

## Security ratings (audit)

Same data and privacy rules as the `skills` CLI (npm `skills` 1.7.0), which calls the skills.sh audit service.

- **Core** (`packages/core/src/audit.ts`): `auditSkills(targets, { enabled?, fetch?, env?, timeout? })` → `{ audits: Map<name, SkillAudit>, unaudited: Map<name, Unaudited> }`. It never throws.
  - A target is `{ name, kind, url }` (a `ResolvedSkill`, or built from a lock entry). Only `kind === "github"` targets are audited, grouped by `owner/repo` (`githubRepo(url)`), with one request per repo, all in parallel.
  - **Privacy**: before a repo's name is sent anywhere else, an unauthenticated `GET https://api.github.com/repos/<owner>/<repo>` must answer 200 with `private: false`. Anything else (private, 404, rate limit, network error) skips the repo. Then `GET https://add-skill.vercel.sh/audit?source=<owner/repo>&skills=<a,b>`. Non-GitHub and private names are never sent.
  - **Opt-out**: nothing is sent when `enabled: false` (`--no-audit`) or when `DO_NOT_TRACK`, `DISABLE_TELEMETRY` or `SCILLA_NO_AUDIT` is non-empty.
  - **Robustness**: 3 s timeout per request (`AbortSignal.timeout`); any failure means no data for that repo. Responses are validated with lenient zod schemas: unknown provider ids pass through, and a provider entry that doesn't parse (such as an unknown risk value) is dropped.
  - `SkillAudit = { providers: { id, label, risk, alerts?, score? }[], worst: Risk | undefined, detailsUrl }`, with `Risk = "safe" | "low" | "medium" | "high" | "critical"`. Labels: `ath` → Gen (Gen Agent Trust Hub), `socket` → Socket, `snyk` → Snyk, `zeroleaks` → ZeroLeaks, other ids as is. Providers are ordered known-first, then by id. `detailsUrl` is `https://skills.sh/<owner/repo>`.
  - Skills with no ratings (missing or `{}`) are absent from `audits`, and `unaudited` says why: `disabled`, `not-github`, `not-public` or `no-data`. The UI shows "not audited", never "safe".
  - `fetch` is injected, so tests never touch the network.
  - Deviation from the brief: the result carries `unaudited` next to the `Map<name, SkillAudit>`, because `scilla audit` has to say why nothing could be audited and only the core knows which repos GitHub didn't confirm as public.
- **add / update**: the audit starts right after the Traversal, in parallel with the picker, and is passed into it (`pickSkills(plan, { audit })`). While it's pending the picker header says "checking ratings…"; when it resolves each rated row gets a badge for `worst` (green `safe`/`low`, amber `medium`, red `high`/`critical`), and unaudited rows get none. The detail pane and the preview header list each provider (label, risk, alerts, score) and the `detailsUrl`, or "not audited (<reason>)". A rejected audit just clears the loading state. It is awaited again after the pick. When any ticked skill has ratings, a "Security risk assessments" table goes to stdout before installing: skill, then Gen, Socket and Snyk, plus a column for any other provider present, then a `Details:` line per repo, and a count of ticked skills that weren't audited. If a ticked skill's `worst` is `medium` or above:
  - attended (TTY, no `-y`): ask `Proceed with installation? [y/N]` through `io.ask` (readline on the bin). Only `y`/`yes` goes ahead; anything else is "Cancelled.", like a cancelled pick.
  - unattended: `warning: Rated medium risk or higher: <skill> (<worst>)…` and continue.
- **`scilla audit [-g]`**: audits every skill in `lock.skills` and prints the same table, `--` for unrated cells, then `Not audited: <names> (<reason>); …`. With nothing audited, only that line appears.

## Docs

- `apps/cli/docs/*.md`, one file per topic: `start`, `concepts`, `sources`, `manifest`, `commands`, `install`, `review`, `audit`, `agents`. They're imported with `with { type: "text" }` (typed by `src/markdown.d.ts`), so `bun build` inlines them into `dist/index.js` and the bin needs no files at runtime.
- `scilla docs` prints a Markdown index (topic, one-line summary, how to read one). `scilla docs <topic>` prints the file. `scilla docs all` prints one llms.txt-style document: an H1 naming the version, a blockquote summary, then every topic with its headings moved one level down (outside code fences). `scilla docs schema` prints `manifestJsonSchema()`. An unknown topic is an error (exit 1) that lists the topics.
- Styling applies only when stdout is a TTY, `--raw` isn't given and `NO_COLOR` is empty: headings bold and cyan without their `#`s, and code fence lines dimmed. Otherwise the output is the exact Markdown. There's no pager and no dependency.
- Drift tests (`apps/cli/src/docs.test.ts`): every command in `COMMAND_NAMES` and every long flag of the parser's `OPTIONS` (`LONG_FLAGS`) appears in `commands.md`; every command in the help is in `COMMAND_NAMES`; every `**Term**:` in CONTEXT.md is defined in `concepts.md`; every manifest and Reference property in the JSON Schema is listed in `manifest.md`; both example review workflows run on a schedule and `workflow_dispatch` with a `bunx scilla-cli` command that parses.

## Distribution

- The published npm package is **`scilla-cli`**; run it with `bunx scilla-cli`. The command it installs is still `scilla` (`"bin": { "scilla": "./dist/index.js" }`).
- The npm name `scilla` is taken (a security holding package), and so is the `@scilla` scope. `@scilla/*` (`@scilla/core`, `@scilla/tui`) stay private, never-published workspace names.

## Stack and layout

- Bun ≥1.4, TypeScript 7, React 19, OpenTUI 0.5.12 (React), tuiparts 0.0.6 primitives. All are pinned exactly. No recipes are vendored: the components are built on the primitives in `@scilla/tui`.
- zod at every I/O boundary: the manifest, locks, frontmatter, CLI args.
- Turborepo on Bun workspaces:
  - `packages/core` (`@scilla/core`): sources, git, manifest, discovery, traversal, hash, lock, install. No UI.
  - `packages/tui` (`@scilla/tui`): OpenTUI React screens (home, picker, prompt) and a spinner.
  - `apps/cli` (`scilla-cli`, the only published package; its bin is `scilla`): args, commands, and a bin bundled by `bun build --production --target bun`, with OpenTUI and React left external, plus the emitted `dist/scilla.schema.json`. Internal packages are JIT (`.ts` exports) `workspace:*` devDependencies.
  - `tools/oxlint/anti-slop`: vendored anti-slop, pinned by commit in `UPSTREAM.md`.
- Quality gates, all turbo root tasks: `lint` (oxlint + anti-slop, strict), `format` (oxfmt), `check` (fallow strict), `check:tests` (coverage-gaps), `check:security`. Per-package tasks: `typecheck`, `test` (`bun test`), `build`.
- Tests: real git fixture repos built in temp dirs. The TUI is tested with `@opentui/react/test-utils` `testRender`.
