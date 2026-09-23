# Traversal semantics

Type: grilling
Status: resolved
Blocked by: 04

## Question

Exactly how does Traversal turn one Collection into the list of installable skills? It must be deterministic. Decide:
- how a referenced repo is recognised as a Nested Collection vs a plain skills repo
- cycle detection and any depth limit
- deduping the same skill reached by two paths (a "diamond")
- conflicting Pins for the same repo
- two different skills with the same name
- whether an outer Curator's recommended/optional marking overrides a Nested Collection's
- how the picker presents nesting (flattened vs tree)

## Comments

- From the repo-conventions research: repos often hold installed copies of other people's skills in `.agents/skills` and `.claude/skills`, so the same skill name turns up more than once. The `skills` CLI skips skills the scanned repo installed itself (those in its own lock). Decide whether Traversal treats those copies as part of a repo or ignores them.
- From Collection manifest format (resolved): a Nested Collection is a repo with `scilla.json` at its root. Installed-copy dirs and skills in the repo's own `skills-lock.json` are **skipped** when scanning for Own Skills, so apply the same rule to referenced repos. From the outside, a Reference resolves to a flat set of named skills, and its `include`/`exclude`/`optional` apply to that set, including a Nested Collection's full output. A duplicate name inside one manifest's own output is a hard error; collisions that arrive through Nested Collections are this ticket's to decide.

## Answer

Decided by the agent under the user's delegation (2026-09-22) when the user skipped the remaining planning and asked to build v1. Recorded in [spec.md](../spec.md), section "Traversal"; this ticket holds no separate detail.
