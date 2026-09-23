# Install and lock model

Type: grilling
Status: resolved
Blocked by: 01, 05

## Question

What does scilla write to disk, and what do `add` / `update` / `delete` do to it?
- Where skills are copied (project vs `--global`, which agent dirs), and whether files are copies or symlinks.
- What the lock records: which Collection(s), the Consumer's selection, resolved commits, hashes. Is it compatible with `skills-lock.json`?
- How `update` reconciles the new Traversal result with the old selection: new skills flagged as new, skills removed upstream, Pin changes.
- What `delete` removes (one skill, or a whole Collection's installs).
- Several Collections installed into one project, including ones that overlap.

## Comments

- From the skills CLI research: `skills-lock.json` has nowhere to store Collection origin, Pin or resolved commit, and `skills` drops unknown top-level keys when it rewrites the file. This probably means a separate scilla lock, or a sidecar next to it. Also, `skills update` overwrites local edits.

## Answer

Decided by the agent under the user's delegation (2026-09-22) when the user skipped the remaining planning and asked to build v1. Recorded in [spec.md](../spec.md), section "Install and lock / Fetching and cache"; this ticket holds no separate detail.
