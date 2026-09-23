# Reviewed updates (outdated, diff, update PRs)

Type: task
Status: resolved
Blocked by:

## Question

Skills are instructions an agent follows, so an upstream change is effectively code running with the user's permissions. Make updates reviewable:
- `scilla outdated [-g]`: installed Collections and References whose upstream moved past the locked commit.
- `scilla diff [collection|skill]`: what changed between the locked commit and upstream: a SKILL.md text diff, added/removed/changed files, executables that are new or changed, and audit rating changes.
- Curator side: `scilla outdated`/`scilla diff` inside a Collection compare each Reference against the commit last recorded for it, and a bump command records the reviewed commit.
- An update-PR automation that opens a PR against the Collection with that diff in the body. It must work on **GitHub, Gitea and Forgejo** (and ideally GitLab). The git work (branch plus commit) is done by scilla; opening the PR goes through a small provider adapter (GitHub REST; Gitea/Forgejo share `/api/v1/repos/{owner}/{repo}/pulls`; GitLab MRs), or scilla prints a PR title and body for `gh`/`tea`/`glab`. The workflow runs on GitHub Actions and on Forgejo/Gitea Actions, which accept GitHub Actions YAML.

Consumers then only get commits a Curator reviewed.

## Answer

Built as `scilla outdated`, `scilla diff`, `scilla review accept` and `scilla review propose` (spec: "Reviewed updates"; `scilla docs review`).

- **Review record**: a committed `scilla-review.json` next to `scilla.json`: `{ "version": 1, "references": { "<Reference as the manifest writes it>": { "commit": "<full sha>" } } }`. A separate machine-written file rather than a manifest block, so the manifest schema doesn't change and the hand-written manifest stays clean. New CONTEXT term: **Review**.
- **Pinning (decided yes)**: a fetched Reference with a Review resolves to its reviewed commit for every Consumer, overriding its Pin, so only reviewed commits reach Consumers and `review accept` (or merging a propose PR) is how a Curator releases an update. References without a Review float as before, which keeps v1 Collections working unchanged. Local References aren't reviewed; Nested Collections follow their own review file.
- **`outdated [-g]`**: Consumer view compares each installed Collection's fresh Traversal with the lock: `changed`, `new`, `removed`, `moved (same files)`, as a table per Collection. Inside a Collection (no `-g`), each Reference is `reviewed`, `outdated`, `floating` or `unreachable`, plus the skills a review would release. **Exit codes**: `0` up to date, `10` when an update (or review) would change skills, `1` on error. Moves alone and floating References don't count.
- **`diff [collection|skill] [-g] [--raw]`**: per skill, the commit move, origin, ratings `was → now` via `auditSkills` (so the opt-outs apply), new or changed files that can run code (highlighted), `A`/`D`/`M` files with binaries marked, and git's unified diff. Both versions are copied to a scratch `a/`/`b/` and diffed with `git diff --no-index`, which works for every origin (local folders too) and gives clean relative paths. The earlier version is the installed copy while it matches the lock, else the locked checkout. Colour only on a TTY.
- **`review propose`**: resets `scilla/review-updates` onto the current branch, bumps the outdated reviewed commits, commits `scilla-review.json` (`chore(review): …`), switches back, and writes a PR title and Markdown body (per-Reference summary, executables, ratings, capped diffs, pointer to `scilla diff`) to stdout or `--title-file`/`--body-file`. `--open` resolves the forge first, force-pushes the branch, and opens the PR or updates the open one: GitHub REST (`GITHUB_TOKEN`, `GITHUB_API_URL`), Gitea/Forgejo `/api/v1/repos/{owner}/{repo}/pulls` (`token` auth from `GITEA_TOKEN`/`FORGEJO_TOKEN`, sub-path installs), GitLab MRs (`GITLAB_TOKEN`/`CI_JOB_TOKEN`). Provider from `--provider`, the remote's host, or the one token that's set. `fetch` is injected; tests never touch the network.
- **Workflows**: `docs/examples/scilla-review.github.yml` and `docs/examples/scilla-review.forgejo.yml` (weekly + `workflow_dispatch`, setup-bun, `bunx scilla-cli review propose --open`), covered by a drift test.
- **TUI**: the update picker shows **changed** instead of **installed** for skills whose upstream files differ from the lock; `d` opens the preview on their diff and toggles back to SKILL.md. The API stays compatible (`Choice.changed` and `PickOptions.diff` are optional).
- Limitation to know: ratings come from a service that rates a repo as it is now, so `was → now` only differs when a skill's origin changed.
