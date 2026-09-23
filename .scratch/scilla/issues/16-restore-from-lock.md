# Restore from the lock (scilla install)

Type: task
Status: resolved
Blocked by:

## Question

`scilla install` with no arguments reproduces exactly what `scilla-lock.json` records: the same Collections, the same selected skills, at the locked commits, without re-resolving upstream. It's non-interactive and suits a postinstall or CI hook, so a teammate gets the team's skills on checkout. It needs `--frozen` (fail if the lock doesn't match what's on disk) and a check mode for CI.

## Answer

Built as `scilla install [-g] [--frozen] [--check] [--force]` (spec: "Restore from the lock").

- **What it installs**: every entry of the lock's `skills`, from its `url` and `path` at its locked `commit`, and nothing else. No Traversal, no picker, no audit, and `scilla-lock.json` is left as it is. Upstream having moved on doesn't matter: the locked commit is installed (tested with `file://` fixtures).
- **Verification**: each copy is hashed before it's installed; a hash other than the lock's `computedHash` fails that skill and nothing is copied.
- **Fetching**: `Fetcher.checkoutCommit` uses a cached checkout or a mirror that already has the commit without fetching, so it works offline once the cache is warm. Only full SHAs reach git, since a lock is editable by anyone.
- **Failures**: a commit gone upstream (force-push) is `error: Can't install <name>: Commit abc1234 is no longer in <url>; was it force-pushed away?`; the other skills continue; exit 1.
- **Local edits**: an installed folder whose hash differs from the lock is skipped with a warning unless `--force`, like `update`. The reason says "local edits, or another version", because after a `git pull` scilla can't tell the two apart.
- **`--check`**: installs nothing; reports `Missing:`, `Modified:`, `Extra:` and exits 1 on any. Extra = a folder in `./.agents/skills` that neither `scilla-lock.json` nor `skills-lock.json` lists; `-g` reports no extras because the home folder is shared with tools that keep no lock there. Nothing is ever deleted.
- **`--frozen`**: install, then the same comparison; exit 1 on any mismatch. Meant for CI.
- **`scilla install <source>`**: an error pointing at `scilla add <source>`, not an alias. `install`'s contract is "never resolve anything new", so a CI script that passes a source by mistake fails loudly. Turning it into an alias later wouldn't break anyone; the reverse would.
- Docs: `commands.md`, `install.md` ("Installing from the lock"), `agents.md` ("a teammate runs `scilla install`"), README ("Sharing a project").
