---
"scilla-cli": minor
---

Add `scilla install`, which installs exactly what `scilla-lock.json` records at the locked commits (with `--frozen` and `--check` for CI), and reviewed updates: `scilla outdated` (exit code 10 when updates are available) and `scilla diff` show what an update would change, and Curators can record reviewed commits in `scilla-review.json` with `scilla review accept`, so Consumers only get reviewed commits. `scilla review propose --open` opens or updates the review pull request on GitHub, Gitea, Forgejo or GitLab, and the update picker marks changed skills and shows their diff with `d`.
