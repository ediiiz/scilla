# The manifest: scilla.json

`scilla.json` at a folder's root makes it a Collection. It's JSON, validated when scilla reads it;
an invalid manifest is always a fatal error, since it's the Curator's to fix. `scilla init` writes
one, and `scilla docs schema` prints its JSON Schema.

```json
{
  "$schema": "https://unpkg.com/scilla-cli/dist/scilla.schema.json",
  "name": "Team",
  "description": "The skills our team uses every day",
  "homepage": "https://example.com/team-skills",
  "exclude": ["scratch-*"],
  "optional": ["experimental-*"],
  "references": [
    "anthropics/skills/skills/pdf",
    "vercel-labs/agent-skills#v1.4.0",
    { "source": "acme/data-skills", "include": ["sql-*"], "optional": true },
    { "source": "git@gitlab.example.com:platform/skills.git", "path": "skills", "ref": "main" },
    { "source": "./vendor", "exclude": ["legacy-*"] }
  ]
}
```

## Fields

- `$schema` (string, optional): the JSON Schema URL, for editor autocomplete and validation.
  `scilla init` writes `https://unpkg.com/scilla-cli/dist/scilla.schema.json` as the first key.
- `name` (string, required): the Collection's name. Shown in the picker and in `scilla list`, and
  usable in `scilla update <name>` and `scilla delete <name>` (case-insensitive).
- `description` (string, required, not empty): one line about the Collection.
- `homepage` (URL, optional): where people can learn more. scilla checks that it's a URL but
  doesn't use it otherwise.
- `exclude` (globs, optional): Own Skills to leave out, matched against skill names. It doesn't
  apply to skills that come through `references`; filter those on the Reference.
- `optional` (globs, optional): skills in this Collection's output (Own Skills and referenced ones)
  that start unticked in the picker and aren't installed by `add -y`.
- `references` (array, optional): References, each a source string or an object.

Own Skills are not listed: every folder with a `SKILL.md` that the scan finds in the Collection is
one (see `scilla docs concepts`).

## Reference entries

A string is a source (see `scilla docs sources`). The object form takes:

- `source` (string, required): the source.
- `path` (string, optional): a folder inside the repo. It replaces any path in `source`, and is the
  only way to give a git URL a path.
- `ref` (string, optional): a Pin. It replaces any `#ref` in `source`.
- `include` (globs, optional): keep only skills whose names match one of these.
- `exclude` (globs, optional): drop skills whose names match one of these.
- `optional` (boolean, optional): `true` makes every skill from this Reference start unticked.

A string and an object with only `source` are the same entry; `scilla ref add` refuses to add an
entry the manifest already has.

## Globs

Globs match skill names (not paths) with Bun's glob syntax: `*`, `?`, `[abc]`, `{a,b}`. For
example `sql-*` matches `sql-review` and `sql-style`. A glob can't be an empty string.
