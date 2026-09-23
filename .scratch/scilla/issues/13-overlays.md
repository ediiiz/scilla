# Customise a referenced skill without forking

Type: grilling
Status: open
Blocked by: 12

## Question

Let a Curator layer changes on top of a Reference and keep receiving upstream updates: append or replace sections, override frontmatter (description, name), add or replace files. Also decide whether a Consumer's local edits should be 3-way merged on update (the base commit is in the lock) instead of skipped. Open points: the patch format (structured ops vs unified diff), conflict handling, how `diff` shows overlays, and how renames interact with the lock and skills-lock.json.
