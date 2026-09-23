# Getting started

scilla installs curated Collections of agent skills. A Collection is a git repo with a `scilla.json`
that bundles skills the Curator wrote (Own Skills) with pointers to skills that live in other repos
(References). One command installs the whole set; another keeps it current with every source.

Skills land in `.agents/skills/<name>/`, the same layout the `skills` CLI uses, and are linked into
`.claude/skills/` when a `.claude` folder exists.

scilla needs Bun 1.4 or newer and fetches through your own `git`, so private repos work with the
credentials git already has.

```sh
bunx scilla-cli            # run without installing
bun add -g scilla-cli      # or install the `scilla` command
```

## Consumer quick start

A Consumer installs skills from a Collection.

```sh
scilla add your-team/skills        # traverse it, pick skills, install into this project
scilla add your-team/skills -g     # install into your home directory instead
scilla add your-team/skills -y     # no picker: install the recommended skills
scilla list                        # what is installed, from which Collection, at which commit
scilla audit                       # security ratings of the installed skills
scilla update                      # pull the latest for every installed Collection
scilla delete some-skill           # remove one skill; update won't bring it back
```

The picker shows every skill with its origin (repo, path, commit). Recommended skills start ticked,
optional ones unticked. Before installing, scilla prints security ratings for the ticked skills
when the audit service has any (see `scilla docs audit`).

## Curator quick start

A Curator creates and maintains a Collection.

```sh
mkdir team-skills && cd team-skills && git init
scilla init --name Team --description "The skills our team uses"
scilla skill new house-style                  # scaffold skills/house-style/SKILL.md
scilla ref add anthropics/skills/skills/pdf   # append a Reference (checked with git ls-remote)
scilla ref add acme/data-skills --include 'sql-*' --optional
scilla check .                                # traverse it: the tree, warnings, name clashes
git add -A && git commit -m "Team skills" && git push
```

There is no registry: the pushed repo is the Collection, and `scilla add <owner>/<repo>` installs
it.

## Read more

- `scilla docs concepts`: the vocabulary
- `scilla docs sources`: every way to name a source
- `scilla docs manifest`: every `scilla.json` field
- `scilla docs commands`: every command and flag
- `scilla docs install`: where files go, the lock files, update and delete
- `scilla docs audit`: security ratings and privacy
- `scilla docs agents`: a checklist for AI agents
