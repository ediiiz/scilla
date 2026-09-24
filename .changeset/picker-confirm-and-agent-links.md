---
"scilla-cli": minor
---

The picker now confirms risky security ratings itself: pressing Enter with a skill rated medium or worse ticked lists those skills and asks `y` to install anyway or `n` to go back, instead of printing the table and a `[y/N]` prompt after the picker closes. When `.claude` doesn't exist yet, the picker also asks once whether to link the skills into `.claude/skills`; the answer is saved as `agentLinks` in `scilla-lock.json`, so updates, `-y` runs and `scilla install` follow it, and saying yes links skills that were already installed too.
