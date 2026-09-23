# Installing, updating and deleting

## Where files go

| What            | Project (default)                                | Global (`-g`)                                    |
| --------------- | ------------------------------------------------ | ------------------------------------------------ |
| Skill folders   | `./.agents/skills/<name>/`                       | `~/.agents/skills/<name>/`                       |
| Agent links     | `./.claude/skills/<name>`, if `./.claude` exists | `~/.claude/skills/<name>`, if `~/.claude` exists |
| scilla's lock   | `./scilla-lock.json`                             | `~/.agents/scilla-lock.json`                     |
| skills CLI lock | `./skills-lock.json`                             | none                                             |

"Project" is the current directory. Each skill folder is copied without `.git` and `node_modules`.
The agent link is a relative symlink to the copy; if a real folder already sits there, it's left
alone with a warning. This is the layout the `skills` CLI uses.

## scilla-lock.json

Version 1, keys sorted, no timestamps, so it diffs cleanly in git.

- `collections[key]`, where the key is the source as `scilla list` shows it:
  - `name`: the Collection's name
  - `source`: `{ kind, url, path, ref?, skill? }`, kept as an object because a git URL with a path
    has no string form
  - `commit`: the commit it was installed at (`local` for a folder)
  - `selected`: the skills installed from it
  - `declined`: the skills the Consumer said no to
- `skills[name]`:
  - `collections`: the keys of every Collection that installed it
  - `kind`, `url`, `path`, `commit`: where it came from
  - `computedHash`: the content hash of what was installed
  - `optional`: whether it was optional

## skills-lock.json

Project installs also add or update an entry per skill in `skills-lock.json` (`source`,
`sourceType`, `skillPath`, `computedHash`, and `sourceUrl` for other git hosts), so the `skills` CLI
sees them. Entries scilla didn't write are kept. A `skills-lock.json` scilla can't read is left
untouched, with a warning. `computedHash` uses the `skills` CLI's algorithm: SHA-256 over each
file's relative path and bytes, files sorted, `.git` and `node_modules` skipped.

## What the picker offers

Each skill in the picker shows its origin (repo, path, short commit). What starts ticked depends
on how it relates to what's installed:

- Offered for the first time: ticked, unless it's optional.
- Installed already: ticked, marked **installed**.
- New upstream since the last install: unticked, marked **new**.
- Declined earlier: unticked.
- A skill with that name is installed from a different origin: marked **conflict**, and it can't
  be ticked.

`--all` ticks everything except conflicts. Skills with executable files (an exec bit or a script
extension such as `.sh`, `.py`, `.js`) are flagged, and warned about again before install.

## Local edits

If an installed folder's hash no longer matches the lock's `computedHash`, you edited it. `update`
and `delete` then leave it alone with `warning: Skipped <name>: has local edits (use --force to
overwrite)`. `--force` overwrites or removes it anyway. A folder in `.agents/skills/` that scilla
didn't install is never replaced without `--force` either.

## update

`scilla update` re-traverses each installed Collection, one at a time:

- A selected skill that's still there is kept, and reinstalled if its contents changed
  (`Updated:`), otherwise `Unchanged:`.
- A skill gone upstream is removed (`Removed:`), unless it has local edits.
- A skill that's new upstream (never selected or declined) is offered unticked.
- The picker opens with the kept skills ticked.

With `-y` or without a terminal, only the kept skills are installed, and new ones are listed:
`N new skill(s) available: a, b (run scilla update <name> to pick)`.

## Declines

Only the picker records declines: a skill you leave unticked there becomes declined, and stays
unticked in later updates. An unattended run (`-y` or no terminal) decides nothing about new
skills, or recommended skills it didn't install (for example after a name clash): they stay
undecided and every later update lists them again. Optional skills an unattended `add` leaves out
are recorded as declined.

## delete

- `scilla delete <collection>` (name or source key) removes that Collection's skills, except ones
  another Collection also installed.
- `scilla delete <skill>` removes one skill and records it as declined in every Collection that had
  it, so `update` won't bring it back. A Collection left with nothing selected stays in the lock
  to remember that.

## Output

Progress (`Resolving <source>…`, a spinner on a terminal) and warnings go to stderr. On stdout:
the security ratings table if there is one (printed before anything is installed), then the
Collection's name, key and short commit, then what happened: `Installed:`, `Updated:`,
`Unchanged:`, `Removed:`, or `Nothing changed.` Each skipped skill is one
`warning: Skipped <name>: <reason>` line on stderr.
