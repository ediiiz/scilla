# Commands

```
scilla <command> [arguments] [flags]
```

Flags can go anywhere on the line. Errors print `error: <message>` on stderr and exit 1. Warnings
print `warning: <message>` on stderr and don't change the exit code. Everything else goes to
stdout.

## Consumer commands

### `scilla`

With no command, on a terminal (stdin and stdout both TTYs), opens the home screen: a menu of the
Consumer actions, plus the Curator actions when the current directory is a Collection. Without a
terminal it prints the help text.

### `scilla add <source> [-g] [-y] [--all] [--force] [--no-audit]`

Traverses the Collection at `<source>` (see `scilla docs sources`), opens the picker with the
recommended skills ticked, and installs the ticked ones. With `-y` or without a terminal there's
no picker: the recommended (non-optional) skills are installed. `--all` ticks every skill,
optional ones included. Before installing it prints the security ratings of the ticked skills
(see `scilla docs audit`).

### `scilla update [collection] [-g] [-y] [--all] [--force] [--no-audit]`

Re-traverses every installed Collection, or just `[collection]` (its name or source key, as
`scilla list` shows them). Changed skills are reinstalled, skills gone upstream are removed, and
new ones are offered unticked. See `scilla docs install` for the details.

### `scilla delete <collection|skill> [-g] [--force]`

Alias: `scilla remove`. Removes a whole Collection (by name or source key), except skills another
Collection also installed, or one skill by name, which is then recorded as declined so `update`
won't bring it back.

### `scilla install [-g] [--frozen] [--check] [--force]`

Installs exactly what `scilla-lock.json` records: every skill it lists, at its locked commit, from
the same repo and path. Nothing upstream is resolved, no picker opens, and nothing the lock doesn't
list is installed, so it's what a teammate runs after cloning a project, and what CI runs. The
lock itself isn't changed. Each skill's files are checked against the lock's `computedHash`
before they're copied. See `scilla docs install`.

- A skill that's already installed with the locked files is `Unchanged:`.
- An installed folder whose files differ from the lock (local edits, or another version) is
  skipped with a warning; `--force` replaces it.
- A skill whose locked commit is gone upstream (a force-pushed branch), or whose files don't match
  the lock's hash, is an `error: Can't install <name>: …` line; the other skills still install,
  and the exit code is 1.
- `--frozen` then compares the installed skills with the lock and exits 1 if any is missing,
  modified, or extra (see `--check`). Use it in CI.
- `--check` installs nothing: it prints `Missing:`, `Modified:` and `Extra:` lines and exits 1 on
  any mismatch, or prints "Everything installed matches scilla-lock.json." Extra means a folder in
  `./.agents/skills` that neither `scilla-lock.json` nor `skills-lock.json` lists; the home
  directory is shared with other tools, so `-g` doesn't look for extras.

`scilla install <source>` is an error that points you at `scilla add <source>`: `install` never
resolves anything new, so a script can't change what's installed by accident.

### `scilla outdated [-g]`

Re-traverses every installed Collection without installing anything and compares it with the
lock. For each Collection it prints its commit move and a table of the skills that differ:
`changed` (their files differ), `new` (never selected or declined), `removed` (gone upstream) and
`moved (same files)` (a new commit, the same files). Exits `10` when an update would change or
offer any skill, `0` when everything is up to date (moves alone don't count), so CI can tell them
apart.

Inside a Collection (the current directory has a `scilla.json`, and no `-g`) it's the Curator's
view instead: each fetched Reference with its state (`reviewed`, `outdated`, `floating`,
`unreachable`), its reviewed commit and its upstream commit, then the skills a review would
release. Exits `10` when a reviewed Reference moved past its reviewed commit. See `scilla docs
review`.

### `scilla diff [collection|skill] [-g] [--raw] [--no-audit]`

Shows what an update would change, skill by skill: the commit move, where it comes from, the
ratings before and after (`Gen safe → medium`), files that can run code and are new or changed
(highlighted), every added (`A`), removed (`D`) and modified (`M`) file, binaries marked, then
git's unified diff of the text files. The earlier version is the installed copy while it still
matches the lock, else the locked commit, so your local edits don't show up as upstream changes.
`[collection]` (name or source key) narrows it to one Collection, and `[skill]` to one skill.
Colours only on a terminal; `--raw`, a pipe or `NO_COLOR` gives plain text. Inside a Collection it
compares each Reference's upstream with its reviewed commit, and `[collection|skill]` may also be
a Reference as the manifest writes it.

### `scilla list [-g]`

Prints each installed Collection (name, source key, short commit) with its skills, then any skills
no Collection claims. A repo without a `scilla.json` is named after its source, so its line shows
the source key once (`owner/repo  063bee9`).

### `scilla audit [-g] [--no-audit]`

Prints security ratings for every installed skill, with `--` where a provider has no rating, and
says which skills couldn't be audited and why. See `scilla docs audit`.

## Curator commands

### `scilla init [--name n] [--description d]`

Writes `scilla.json` in the current directory with `$schema`, `name`, `description` and empty
`references`. The name defaults to the directory's name; the description defaults to "The <name>
Collection of agent skills." Fails if `scilla.json` already exists.

### `scilla ref add <source> [--optional] [--include glob] [--exclude glob] [--no-verify]`

Appends a Reference to the Collection in the current directory. `--include` and `--exclude` can be
repeated; with any of `--optional`, `--include` or `--exclude` the entry is written in object form.
The source must parse, a local path must exist, and an entry the manifest already has is refused.
A git or GitHub source is checked with `git ls-remote --exit-code` (and its Pin, unless it's a
commit SHA), with a 10 second limit. If the check fails the Reference is still added, with a
warning, since you may be offline or lack credentials. `--no-verify` skips the check.

### `scilla skill new <name>`

Scaffolds `skills/<name>/SKILL.md` in the current directory. The name must be lowercase letters,
digits and single hyphens.

### `scilla check [dir]`

Traverses the local Collection in `[dir]` (default: the current directory) and prints its skills
grouped by where they came from, each with its origin, `(optional)` and any executable files, then
the count and all warnings. Name collisions that would fail an install fail here too.

### `scilla outdated` and `scilla diff` in a Collection

In a Collection's folder, both compare each fetched Reference's upstream with the commit
recorded as reviewed in `scilla-review.json`; see above and `scilla docs review`.

### `scilla review accept [reference]`

Records the upstream commit of every fetched Reference (or just `[reference]`, as the manifest
writes it or as its source key) as reviewed in `scilla-review.json`, and prints each move:
`Reviewed <reference>: abc1234 → def5678` (`floating → …` the first time). A Reference with a
reviewed commit resolves to that commit for Consumers, so committing the file is how you release
an update. A Reference that can't be fetched keeps what it had, with a warning. Entries for
References the manifest no longer has are dropped.

### `scilla review propose [--open] [--provider p] [--title-file f] [--body-file f] [--no-audit]`

For automation, in a git checkout of the Collection: works out which reviewed References moved
upstream, resets the branch `scilla/review-updates` onto the current branch, bumps their reviewed
commits there, commits `scilla-review.json` (`chore(review): bump the reviewed commit of …`) and
switches back. It then writes a pull request title and a Markdown body (per Reference: the skills
that changed, files that can run code, ratings, and the diffs, capped, with a pointer to `scilla
diff`) to stdout, or to `--title-file` and `--body-file`. Progress goes to stderr. With nothing
outdated it says so and exits 0.

`--open` also force-pushes the branch to `origin` and opens a pull request for it, or updates the
title and body of the one already open. The forge comes from `--provider github|gitea|forgejo|gitlab`,
else from `origin`'s host (`github.com`, `gitlab.com` or a host with `gitlab` in its name,
`codeberg.org`, `gitea.com`), else from the one token variable that is set. See `scilla docs
review` for tokens and CI workflows.

## Docs

### `scilla docs [topic] [--raw]`

With no topic, lists the topics. `scilla docs <topic>` prints one: `start`, `concepts`, `sources`,
`manifest`, `commands`, `install`, `review`, `audit`, `agents`. `scilla docs all` prints every topic as one
document; `scilla docs schema` prints the `scilla.json` JSON Schema. On a terminal headings are
styled; `--raw`, a pipe or `NO_COLOR` gives plain Markdown. An unknown topic exits 1 and lists the
topics.

## Flags

| Flag                | Commands                                                  | Meaning                                                                                |
| ------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `-g`, `--global`    | add, update, delete, install, outdated, diff, list, audit | Use the home directory instead of the project                                          |
| `-y`, `--yes`       | add, update                                               | No picker; install the recommended skills                                              |
| `--all`             | add, update                                               | Tick every skill: optional, new and declined ones too                                  |
| `--force`           | add, update, delete, install                              | Overwrite or remove skills with local edits, and replace folders scilla didn't install |
| `--no-audit`        | add, update, audit, diff, review propose                  | Don't fetch security ratings                                                           |
| `--frozen`          | install                                                   | Exit 1 when the installed skills still differ from the lock afterwards                 |
| `--check`           | install                                                   | Install nothing; report how the installed skills differ from the lock                  |
| `--name <n>`        | init                                                      | The Collection's name                                                                  |
| `--description <d>` | init                                                      | The Collection's description                                                           |
| `--optional`        | ref add                                                   | Mark the Reference's skills optional                                                   |
| `--include <glob>`  | ref add                                                   | Keep only matching skill names (repeatable)                                            |
| `--exclude <glob>`  | ref add                                                   | Drop matching skill names (repeatable)                                                 |
| `--no-verify`       | ref add                                                   | Don't check that a git source is reachable                                             |
| `--open`            | review propose                                            | Push `scilla/review-updates` and open (or update) its pull request                     |
| `--provider <p>`    | review propose                                            | `github`, `gitea`, `forgejo` or `gitlab`, when `origin`'s host doesn't tell            |
| `--title-file <f>`  | review propose                                            | Write the pull request title to a file instead of stdout                               |
| `--body-file <f>`   | review propose                                            | Write the pull request body to a file instead of stdout                                |
| `--raw`             | docs, diff                                                | Plain text, even on a terminal                                                         |
| `-h`, `--help`      | any                                                       | Show the help text                                                                     |
| `-v`, `--version`   | any                                                       | Show the version                                                                       |

`--help` and `--version` win over any command on the line.

## Environment

- `SCILLA_CACHE_DIR`: where git mirrors and checkouts are cached (default
  `$XDG_CACHE_HOME/scilla`, else `~/.cache/scilla`).
- `SCILLA_HOME`: used instead of your home directory for `-g` and `~`.
- A path variable (`SCILLA_CACHE_DIR`, `SCILLA_HOME`, `XDG_CACHE_HOME`) that's empty or only
  spaces counts as unset, so it never means the current directory.
- `SCILLA_DEBUG`: any value adds git's full output under errors and warnings, and a stack trace
  under unexpected errors.
- `SCILLA_NO_AUDIT`, `DO_NOT_TRACK`, `DISABLE_TELEMETRY`: any value turns security ratings off.
- `NO_COLOR`: any value makes `scilla docs` and `scilla diff` print plain text.
- `GITHUB_TOKEN`, `GITEA_TOKEN`, `FORGEJO_TOKEN`, `GITLAB_TOKEN`, `CI_JOB_TOKEN`: the token
  `scilla review propose --open` uses for its provider; `GITHUB_API_URL` points it at GitHub
  Enterprise. See `scilla docs review`.

## Exit codes

- `0`: success, including "Nothing changed." and a cancelled picker ("Cancelled."), and
  `scilla outdated` when nothing would change.
- `1`: an error; the message is on stderr. `scilla install` also exits 1 when a skill couldn't be
  installed, and with `--frozen` or `--check` when the installed skills don't match the lock.
- `10`: `scilla outdated` found something an update (or, in a Collection, a review) would change.
  In CI, treat it as "updates available", not as a failure.
