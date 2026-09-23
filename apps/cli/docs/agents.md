# For AI agents

A checklist for agents that run scilla on someone's behalf.

## Checklist

- **Always pass `-y` to `add` and `update`.** The picker and the home screen need a real terminal.
  With `-y` (or without a terminal) scilla installs the recommended skills and never waits for
  input. Never run bare `scilla`: without a terminal it only prints help.
- **`--all` installs everything**, optional skills included, and on `update` also skills the human
  declined earlier. Use it only when asked for everything.
- **A teammate runs `scilla install`**: in a project with a `scilla-lock.json`, `scilla install`
  installs exactly the locked skills at the locked commits, with no picker and nothing resolved
  upstream. Use it after cloning, and `scilla install --frozen` (or `--check`) in CI. Don't run
  `add` or `update` to "restore" a project: they move to what upstream has now.
- **Look before and after**: `scilla list` shows what's installed, from which Collection, at which
  commit. `scilla audit` shows security ratings of installed skills.
- **Review before updating**: `scilla outdated` exits `10` when an update would change skills (not
  an error), and `scilla diff` shows the changes. Summarise them for the human, especially
  highlighted files that can run code, before running `scilla update -y`.
- **Curating**: after editing `scilla.json` or adding skills, run `scilla check .` to traverse the
  Collection and see its tree, warnings and name clashes.
- **Exit codes**: `0` means success (also "Nothing changed." and "Cancelled."); `1` means an error,
  with `error: <message>` on stderr; `10` is `scilla outdated` saying updates are available. Warnings go to stderr as `warning: <message>` and don't change
  the exit code; read them, they name skipped skills and failed References.
- **Never use `--force` without asking the human.** It overwrites their local edits to installed
  skills and replaces folders scilla didn't install.
- **Curating**: `scilla review accept` releases upstream commits to every Consumer of the
  Collection. Only run it, or `scilla review propose --open`, when the human asked for it.
- **Security ratings**: with `-y`, risky ratings (medium or worse) are only warned about. Tell the
  human about any `warning: Rated medium risk or higher: …` line. "Not audited" is not "safe".
- **Declined skills**: skills left out by `-y` stay undecided, so `update -y` lists new ones as
  `N new skill(s) available: …`. Ask the human before installing them.

## Useful commands

```sh
scilla install                      # a teammate: install exactly what scilla-lock.json records
scilla install --frozen             # CI: fail when the installed skills don't match the lock
scilla add owner/repo -y            # install a Collection's recommended skills
scilla add owner/repo -y --all      # ...or every skill
scilla outdated                     # what an update would change (exit 10 if anything)
scilla diff                         # the changes, skill by skill
scilla update -y                    # refresh everything installed
scilla list                         # what is installed
scilla audit                        # security ratings of installed skills
scilla check .                      # validate the Collection in this directory
scilla docs schema                  # the scilla.json JSON Schema
```

## Reading these docs

- `scilla docs` lists the topics; `scilla docs <topic>` prints one.
- `scilla docs all` prints every topic in one Markdown document: the best single read for an
  agent.
- Output is plain Markdown whenever stdout isn't a terminal; pass `--raw` to be sure.
- Error messages end with a `see: scilla docs <topic>` hint where a topic explains the fix.
