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

### `scilla list [-g]`

Prints each installed Collection (name, source key, short commit) with its skills, then any skills
no Collection claims.

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

## Docs

### `scilla docs [topic] [--raw]`

With no topic, lists the topics. `scilla docs <topic>` prints one: `start`, `concepts`, `sources`,
`manifest`, `commands`, `install`, `audit`, `agents`. `scilla docs all` prints every topic as one
document; `scilla docs schema` prints the `scilla.json` JSON Schema. On a terminal headings are
styled; `--raw`, a pipe or `NO_COLOR` gives plain Markdown. An unknown topic exits 1 and lists the
topics.

## Flags

| Flag                | Commands                         | Meaning                                                                                |
| ------------------- | -------------------------------- | -------------------------------------------------------------------------------------- |
| `-g`, `--global`    | add, update, delete, list, audit | Use the home directory instead of the project                                          |
| `-y`, `--yes`       | add, update                      | No picker; install the recommended skills                                              |
| `--all`             | add, update                      | Tick every skill: optional, new and declined ones too                                  |
| `--force`           | add, update, delete              | Overwrite or remove skills with local edits, and replace folders scilla didn't install |
| `--no-audit`        | add, update, audit               | Don't fetch security ratings                                                           |
| `--name <n>`        | init                             | The Collection's name                                                                  |
| `--description <d>` | init                             | The Collection's description                                                           |
| `--optional`        | ref add                          | Mark the Reference's skills optional                                                   |
| `--include <glob>`  | ref add                          | Keep only matching skill names (repeatable)                                            |
| `--exclude <glob>`  | ref add                          | Drop matching skill names (repeatable)                                                 |
| `--no-verify`       | ref add                          | Don't check that a git source is reachable                                             |
| `--raw`             | docs                             | Plain Markdown, even on a terminal                                                     |
| `-h`, `--help`      | any                              | Show the help text                                                                     |
| `-v`, `--version`   | any                              | Show the version                                                                       |

`--help` and `--version` win over any command on the line.

## Environment

- `SCILLA_CACHE_DIR`: where git mirrors and checkouts are cached (default
  `$XDG_CACHE_HOME/scilla`, else `~/.cache/scilla`).
- `SCILLA_HOME`: used instead of your home directory for `-g` and `~`.
- `SCILLA_DEBUG`: any value adds git's full output under errors and warnings, and a stack trace
  under unexpected errors.
- `SCILLA_NO_AUDIT`, `DO_NOT_TRACK`, `DISABLE_TELEMETRY`: any value turns security ratings off.
- `NO_COLOR`: any value makes `scilla docs` print plain Markdown.

## Exit codes

- `0`: success, including "Nothing changed." and a cancelled picker ("Cancelled.").
- `1`: an error; the message is on stderr.
