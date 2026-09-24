---
"scilla-cli": patch
---

Download only what scilla reads: a Reference now fetches its Pin's commit without history, and only the files under its path, so a Reference into a big repo such as `vercel/ai` takes a few hundred KB instead of hundreds of MB. This also fixes `git checkout failed: ... Filename too long` on Windows, where files outside the Reference's path are no longer written and checkouts allow paths longer than 260 characters. Lock files record skill paths with `/` on every OS.
