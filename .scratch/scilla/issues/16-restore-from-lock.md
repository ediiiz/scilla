# Restore from the lock (scilla install)

Type: task
Status: claimed
Blocked by:

## Question

`scilla install` with no arguments reproduces exactly what `scilla-lock.json` records: the same Collections, the same selected skills, at the locked commits, without re-resolving upstream. It's non-interactive and suits a postinstall or CI hook, so a teammate gets the team's skills on checkout. It needs `--frozen` (fail if the lock doesn't match what's on disk) and a check mode for CI.
