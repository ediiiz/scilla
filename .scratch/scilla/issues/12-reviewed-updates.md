# Reviewed updates (outdated, diff, update PRs)

Type: task
Status: claimed
Blocked by:

## Question

Skills are instructions an agent follows, so an upstream change is effectively code running with the user's permissions. Make updates reviewable:
- `scilla outdated [-g]`: installed Collections and References whose upstream moved past the locked commit.
- `scilla diff [collection|skill]`: what changed between the locked commit and upstream: a SKILL.md text diff, added/removed/changed files, executables that are new or changed, and audit rating changes.
- Curator side: `scilla outdated`/`scilla diff` inside a Collection compare each Reference against the commit last recorded for it, and a bump command records the reviewed commit.
- An update-PR automation that opens a PR against the Collection with that diff in the body. It must work on **GitHub, Gitea and Forgejo** (and ideally GitLab). The git work (branch plus commit) is done by scilla; opening the PR goes through a small provider adapter (GitHub REST; Gitea/Forgejo share `/api/v1/repos/{owner}/{repo}/pulls`; GitLab MRs), or scilla prints a PR title and body for `gh`/`tea`/`glab`. The workflow runs on GitHub Actions and on Forgejo/Gitea Actions, which accept GitHub Actions YAML.

Consumers then only get commits a Curator reviewed.
