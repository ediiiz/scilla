# Scilla

Scilla lets anyone publish a curated set of agent skills as a git repo, mixing skills they wrote with pointers to skills maintained elsewhere, so others can install a ready-made kit without anyone hand-copying or hand-updating third-party skills.

## Language

### Collections

**Collection**:
A git repo managed by scilla that bundles Own Skills and References into one installable, curated set (e.g. "svelte skills").
_Avoid_: Pack, bundle, kit, registry

**Manifest**:
The file whose presence makes a repo a Collection; it declares the Collection's name, description, and References. Own Skills are found by scanning, not listed.
_Avoid_: Config, collection file

**Own Skill**:
A skill whose files live inside the Collection itself.
_Avoid_: Local skill, native skill

**Reference**:
A pointer from a Collection to skills that live in another repo — either a single skill, or a whole repo/folder of skills.
_Avoid_: Link, dependency, import

**Nested Collection**:
A Collection reached through a Reference; its own References are followed in turn.
_Avoid_: Sub-collection

**Traversal**:
Following References outward from a Collection — scanning repos for skills and recursing into Nested Collections — to produce the full set of installable skills.
_Avoid_: Crawl, resolve

**Pin**:
An optional fixed git ref on a Reference; without one, the Reference floats to upstream's latest.

**Review**:
The commit of a Reference that its Curator last checked, recorded in the Collection's `scilla-review.json`. A reviewed Reference resolves to that commit for Consumers, whatever its Pin says; one without a Review floats as before.
_Avoid_: Approval, vetting, sign-off

### Roles

**Curator**:
The person who creates and maintains a Collection.
_Avoid_: Author, owner, publisher

**Consumer**:
The person who installs skills from a Collection into their project or machine.
_Avoid_: User, subscriber
