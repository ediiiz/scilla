# CLI surface

Type: grilling
Status: resolved
Blocked by: 04, 06

## Question

What is the full command and flag set?
- Consumer: `add`, `update`, `delete`, plus maybe `list`.
- Curator: `init`, adding a Reference, adding an Own Skill, validate/preview a Collection.
- Non-interactive use (`--yes`, `--all`, selecting skills by name, CI).
- Output and exit codes.
- How the CLI and TUI share one core, so every TUI action is also scriptable.

## Answer

Decided by the agent under the user's delegation (2026-09-22) when the user skipped the remaining planning and asked to build v1. Recorded in [spec.md](../spec.md), section "CLI surface"; this ticket holds no separate detail.
