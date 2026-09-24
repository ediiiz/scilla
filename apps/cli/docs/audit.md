# Security ratings

Skills are instructions your agent follows, sometimes with scripts. scilla doesn't sandbox them,
but it shows what independent scanners think of a skill before you install it, the same ratings
the `skills` CLI shows.

## Where ratings come from

The ratings come from the skills.sh audit service (`https://add-skill.vercel.sh/audit`), which
collects assessments from these providers:

| Column    | Provider            |
| --------- | ------------------- |
| Gen       | Gen Agent Trust Hub |
| Socket    | Socket              |
| Snyk      | Snyk                |
| ZeroLeaks | ZeroLeaks           |

Providers scilla doesn't know yet get a column under their own id. Each rating is one of `safe`,
`low`, `medium`, `high` or `critical`; Socket's alert count is shown when it isn't zero. The full
assessment for a repo is at `https://skills.sh/<owner>/<repo>`, printed under the table.

```
Security risk assessments
  Skill                  Gen   Socket  Snyk  ZeroLeaks
  react-best-practices   safe  safe    low   --
  web-design-guidelines  safe  safe    low   safe
  Details: https://skills.sh/vercel-labs/agent-skills
```

`--` means that provider has no rating for the skill. A skill without any rating is **not
audited**, which says nothing about whether it's safe.

## When scilla asks

- `scilla add` and `scilla update` fetch ratings while the picker is open. The picker says
  "checking ratings…" until they arrive, then badges each rated skill with its worst rating; the
  detail pane and the preview list every provider's rating, or say why a skill wasn't audited.
- When you press Enter and a ticked skill is rated `medium` or worse by any provider, the picker
  lists those skills and asks: `y` installs anyway, `n` or Esc goes back to the list. Enter before
  the ratings arrive waits for them, and `y` installs without waiting.
- With `-y` or without a terminal, there's no picker: scilla prints the table for the ticked
  skills that have ratings, warns about the risky ones on stderr, and goes ahead.
- `scilla audit [-g]` prints the table for every installed skill, then which ones weren't audited
  and why.

An audit never fails a command: a slow or broken service just means no ratings.

## Privacy

Only skills from GitHub repos named `owner/repo` or `https://github.com/owner/repo` are rated,
and only when the repo is public:

1. scilla asks GitHub's API whether the repo is public, without credentials:
   `GET https://api.github.com/repos/<owner>/<repo>`. Only an answer of `"private": false` counts;
   a private or missing repo, an error or a rate limit (60 requests an hour without credentials)
   means the repo is skipped.
2. For a public repo it sends one request with the repo and the names of its skills:
   `GET https://add-skill.vercel.sh/audit?source=<owner>/<repo>&skills=<name>,<name>`.

Nothing is sent for skills from other git hosts, SSH URLs (even `git@github.com:…`) or local
folders, and the names of private repos and their skills never leave your machine. Each request
has a 3 second limit, and requests for different repos run in parallel.

`scilla audit` explains skipped skills with one of: "not from GitHub", "not a public GitHub repo",
"no ratings yet" (the service has nothing, or didn't answer in time), or "ratings are turned off".

## Turning it off

Any of these turns ratings off, and then nothing is sent at all:

- `--no-audit` on `add`, `update` or `audit`
- `SCILLA_NO_AUDIT=1`
- `DO_NOT_TRACK=1`
- `DISABLE_TELEMETRY=1`

Any non-empty value counts.
