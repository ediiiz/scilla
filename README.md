# scilla

> Curated Collections of agent skills. One command to install them, one to keep them current.

---

Ever had to track down all your skill sources again?

You found a great PDF skill in someone's repo last month. The SQL reviewer came from a gist a colleague shared in Slack. Your team's house-style skill lives in an internal repo, and the frontend skills came from that big community repo. Which folder was it again? You've lost count.

Then a new project starts. You open six browser tabs, clone four repos and copy folders into `.claude/skills` by hand. You forget one. A teammate starts a project the next week and does the whole dance again, getting slightly different versions.

Or you did the sensible thing and made **your own skills repo**: one place, everything copied in. It worked for a while. But the upstream skills kept improving, and your copies didn't. Now updating your skills repo means re-downloading each source, diffing folders, and hoping you didn't overwrite the one you tweaked. So you stop updating it, and your "curated" repo slowly rots.

**scilla fixes this by letting your skills repo point at skills instead of copying them.**

You write a short `scilla.json` that says "these are my own skills, plus that repo, plus that one skill from over there." That repo is now a **Collection**. Anyone can install it with one command, and `scilla update` pulls the latest from every source it points to.

```sh
bunx scilla-cli add your-team/skills
```

A picker opens with every skill the Collection brings in, showing where each one comes from. The recommended skills are already ticked. Press enter and they're installed.

---

## How it works

**The Curator** (the person who maintains a Collection) keeps a git repo like this:

```
team-skills/
├── scilla.json
└── skills/
    └── house-style/
        └── SKILL.md
```

```json
{
  "$schema": "https://unpkg.com/scilla-cli/dist/scilla.schema.json",
  "name": "Team",
  "description": "The skills our team uses every day",
  "references": [
    "anthropics/skills/skills/pdf",
    "vercel-labs/agent-skills#v1.4.0",
    { "source": "acme/data-skills", "include": ["sql-*"], "optional": true },
    "git@gitlab.example.com:platform/skills.git"
  ]
}
```

- **Own Skills**: skills that live in the Collection repo itself. scilla finds them by scanning the repo; you don't list them.
- **References**: pointers to skills that live elsewhere. A Reference can be a whole repo, a folder, or one skill (`@name`).
  - Filter with `include`/`exclude` globs.
  - Mark skills `optional` so they start unticked.
  - Pin a git ref with `#v1.4.0`; without a Pin, the Reference follows the latest upstream.
- **Nested Collections**: when a Reference points at another Collection, scilla follows that Collection's References too, and detects cycles.

**The Consumer** (anyone installing it) runs `scilla add`. scilla follows every Reference (this is called a **Traversal**), shows you the full set, and installs what you pick into `.agents/skills`. If `.claude` exists, it also symlinks each skill into `.claude/skills`. This is the same layout the [`skills`](https://github.com/vercel-labs/skills) CLI uses, and scilla keeps `skills-lock.json` in sync so both tools agree.

Nobody copies third-party skills by hand anymore. The Curator curates, and the sources stay where they are.

## Install

scilla runs on [Bun](https://bun.sh) ≥ 1.4.

```sh
bunx scilla-cli            # run without installing
bun add -g scilla-cli      # or install the `scilla` command globally
```

`npx scilla-cli` and `npm install -g scilla-cli` work too, as long as Bun is on your `PATH`: the `scilla` command is a small Node launcher that hands over to Bun, and tells you where to get Bun if it's missing.

Fetching goes through your own `git`, so private repos work with whatever credentials git already has (SSH keys, a credential helper, `gh auth`).

## Using a Collection

```sh
scilla add your-team/skills          # pick and install into this project
scilla add your-team/skills -g       # …or into your home directory, for every project
scilla add your-team/skills -y       # no picker: install the recommended skills
scilla add your-team/skills --all    # no picker: install everything, optional skills included

scilla list                          # what's installed, from which Collection, at which commit
scilla audit                         # security ratings of what's installed
scilla update                        # pull the latest for every installed Collection
scilla update Team                   # …or just one
scilla delete sql-helper             # remove one skill; update won't bring it back
scilla delete Team                   # remove a whole Collection

scilla                               # home screen: the same actions, as a menu
```

What `update` does:

- **Changed upstream:** reinstalled.
- **New upstream:** shown as **new** and unticked. You opt in; nothing arrives without your say.
- **Gone upstream:** removed.
- **Edited locally:** left alone, with a warning. Pass `--force` if you really want the upstream version.
- **Declined:** a skill you declined or deleted stays declined.

## Making a Collection

```sh
mkdir team-skills && cd team-skills && git init
scilla init --name Team --description "The skills our team uses every day"
scilla skill new house-style                  # scaffolds skills/house-style/SKILL.md
scilla ref add anthropics/skills/skills/pdf   # checks the source is reachable, then appends it
scilla ref add acme/data-skills --include 'sql-*' --optional
scilla check .                                # traverse it: the full tree, warnings, name clashes
git add -A && git commit -m "Team skills" && git push
```

That's it. There's no registry and nothing to publish. The git repo is the Collection.

You can hand-edit `scilla.json` whenever you like. The `$schema` line gives your editor autocomplete and validation.

## Sources

Anywhere scilla takes a source (`add`, `ref add`, or `references` in `scilla.json`), these all work:

| Source                                    | Meaning                           |
| ----------------------------------------- | --------------------------------- |
| `owner/repo`                              | A GitHub repo                     |
| `owner/repo/path/to/folder`               | A folder inside it                |
| `owner/repo@skill-name`                   | One skill, by name                |
| `owner/repo#v1.2.0`                       | Pinned to a tag, branch or commit |
| `https://github.com/owner/repo`           | The same as `owner/repo`          |
| `https://github.com/owner/repo/tree/v2/x` | A folder link copied from GitHub  |
| `https://…/repo.git`, `git@host:repo.git` | Any git host                      |
| `./vendor/skills`, `~/my-skills`          | A local folder                    |

## Trust

Skills are instructions your agent follows, and sometimes they come with scripts. scilla doesn't sandbox anything, but it does make everything visible before you install:

- Every skill in the picker shows its origin: repo, path and exact commit.
- Skills that contain executable files are flagged, and scilla warns again before installing them.
- `scilla-lock.json` records the exact commit and content hash of everything installed, so you can review changes in git like any other code.
- A remote Collection can't reach into your disk. Absolute paths, `~` and `..` in its References are refused.

### Security ratings

You probably don't read every script in every skill before you install it. Independent scanners do, and scilla shows you what they found. While the picker is open, scilla asks the [skills.sh](https://skills.sh) audit service for ratings, the same ones the `skills` CLI shows. As they arrive, each rated skill in the picker gets a badge with its worst rating (green for `safe` or `low`, amber for `medium`, red for `high` or `critical`), and its detail pane lists what every scanner said. Once you've picked, and before anything is installed, you get a table:

```
Security risk assessments
  Skill                  Gen   Socket  Snyk  ZeroLeaks
  react-best-practices   safe  safe    low   --
  web-design-guidelines  safe  safe    low   safe
  Details: https://skills.sh/vercel-labs/agent-skills
```

- **Rated medium or worse:** on a terminal, scilla asks `Proceed with installation? [y/N]` first. With `-y`, it warns and carries on.
- **Later:** `scilla audit` shows the same table for everything you've installed.
- **Not audited:** a skill without ratings shows `--`. That means nobody has rated it, not that it's safe.
- **Privacy:** only public GitHub repos are rated. scilla checks with GitHub that a repo is public before it sends the repo's name and its skill names. Private repos, SSH URLs, other git hosts and local folders never leave your machine.
- **Opting out:** `--no-audit`, or set `SCILLA_NO_AUDIT`, `DO_NOT_TRACK` or `DISABLE_TELEMETRY`.

The details are in `scilla docs audit`.

## Docs, for people and agents

The manual ships inside scilla, so it always matches the version you run:

```sh
scilla docs                # the topics, one line each
scilla docs sources        # one topic: start, concepts, sources, manifest, commands, install, audit, agents
scilla docs all            # everything in one Markdown document, llms.txt style
scilla docs schema         # the scilla.json JSON Schema
```

On a terminal the headings are lightly styled. Piped, or with `--raw`, it's plain Markdown, which is just what an AI agent wants. `scilla docs agents` is a checklist written for them: always pass `-y`, never `--force` without asking, and read the `warning:` lines. When an error has a topic that explains it, the error says so, for example `see: scilla docs sources`.

## Development

It's a Bun + Turborepo monorepo:

```
apps/cli         scilla-cli: the command and its bundled bin
packages/core    @scilla/core: sources, git, Traversal, install, locks (no UI)
packages/tui     @scilla/tui: the picker and home screen (OpenTUI + tuiparts)
```

```sh
bun install
bun run verify          # typecheck, test, build, lint, format, fallow, all through turbo
```

Changes users will notice need a changeset (`bun changeset`); releases to npm are automated. See [Releasing](https://github.com/ediiiz/scilla/blob/main/docs/releasing.md).

Linting uses [oxlint](https://oxc.rs) with the [anti-slop](https://github.com/dmmulroy/anti-slop) rules, formatting uses oxfmt, and [fallow](https://github.com/fallow-rs/fallow) enforces strict dead-code, duplication, complexity and coverage checks. `CONTEXT.md` defines the vocabulary used throughout the code.

---

_Why "scilla"?_ Squill (_Scilla_) grows from a bulb and comes back every spring. That's what your skills should do too.
