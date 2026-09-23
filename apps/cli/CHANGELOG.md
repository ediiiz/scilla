# scilla-cli

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
