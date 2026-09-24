# scilla-cli

## 0.3.0

### Minor Changes

- fd24f69: The picker now confirms risky security ratings itself: pressing Enter with a skill rated medium or worse ticked lists those skills and asks `y` to install anyway or `n` to go back, instead of printing the table and a `[y/N]` prompt after the picker closes. When `.claude` doesn't exist yet, the picker also asks once whether to link the skills into `.claude/skills`; the answer is saved as `agentLinks` in `scilla-lock.json`, so updates, `-y` runs and `scilla install` follow it, and saying yes links skills that were already installed too.

## 0.2.1

### Patch Changes

- 8741577: Download only what scilla reads: a Reference now fetches its Pin's commit without history, and only the files under its path, so a Reference into a big repo such as `vercel/ai` takes a few hundred KB instead of hundreds of MB. This also fixes `git checkout failed: ... Filename too long` on Windows, where files outside the Reference's path are no longer written and checkouts allow paths longer than 260 characters. Lock files record skill paths with `/` on every OS.

## 0.2.0

### Minor Changes

- 40d9a77: Add `scilla install`, which installs exactly what `scilla-lock.json` records at the locked commits (with `--frozen` and `--check` for CI), and reviewed updates: `scilla outdated` (exit code 10 when updates are available) and `scilla diff` show what an update would change, and Curators can record reviewed commits in `scilla-review.json` with `scilla review accept`, so Consumers only get reviewed commits. `scilla review propose --open` opens or updates the review pull request on GitHub, Gitea, Forgejo or GitLab, and the update picker marks changed skills and shows their diff with `d`.

## 0.1.1

### Patch Changes

- 7d67af6: Fix a batch of bugs:

  - An empty or blank `SCILLA_CACHE_DIR`, `XDG_CACHE_HOME` or `SCILLA_HOME` now counts as unset instead of meaning the current directory. Skill discovery also never scans into a scilla cache.
  - GitHub page links such as `https://github.com/owner/repo/tree/v2/skills/pdf` or `…/blob/v2/pdf/SKILL.md` now work as sources. `scilla ref add` stores them as shorthand (`owner/repo/skills/pdf#v2`), and `main` and `master` float with the default branch instead of becoming a Pin.
  - Executable detection is narrower. A file counts when it has the exec bit, is a shell-type script, is a script directly inside `scripts/` or `bin/`, or starts with `#!`. Library `.ts`/`.mjs` files and `.d.ts` no longer count.
  - Executable warnings, `scilla check` and the picker's detail pane list at most 5 files, then `+N more`.
  - `scilla list` names a repo without a `scilla.json` once, not twice.

## 0.1.0

### Minor Changes

- 4d87fcf: First release of scilla: install curated Collections of agent skills with `scilla add`, keep them current with `scilla update`, and curate your own with `scilla init`, `scilla skill new` and `scilla ref add`.
