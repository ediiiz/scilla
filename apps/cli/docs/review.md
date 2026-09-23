# Reviewed updates

Skills are instructions an agent follows, and some come with scripts, so an upstream change is
effectively code that runs with your permissions. scilla lets you read every change before it
arrives: Consumers can check what an update would bring, and Curators can make sure only commits
they reviewed reach anyone.

## For Consumers

```sh
scilla outdated          # what an update would change; exits 10 when anything would
scilla diff              # the changes themselves, skill by skill
scilla diff pdf          # ...for one skill, or one Collection (name or source key)
scilla update            # install them
```

`scilla outdated` re-traverses each installed Collection without installing anything and lists the
skills that `changed` (their files differ from the lock), are `new`, were `removed` upstream, or
only `moved (same files)` to a new commit. `scilla diff` shows, per skill, the commit move, the
ratings before and after, files that can run code and are new or changed, every added, removed and
modified file, and git's unified diff. In the update picker, such skills carry a **changed** badge,
and `d` shows their changes in the preview.

Exit code `10` means "updates available", so CI can tell it apart from an error (`1`):

```sh
status=0
scilla outdated || status=$?
if [ "$status" -eq 10 ]; then echo "updates waiting"; elif [ "$status" -ne 0 ]; then exit "$status"; fi
```

## For Curators: reviewing References

A Collection can record, per Reference, the upstream commit its Curator last reviewed. That record
is `scilla-review.json`, committed next to `scilla.json`:

```json
{
  "version": 1,
  "references": {
    "anthropics/skills/skills/pdf": { "commit": "3f2a9c0e5b1d4a7f8e6c2b9d0a1f3e5c7b9d2a4f" }
  }
}
```

- The key is the Reference as `scilla.json` writes it: the source string, or `source (path)` for
  an object with a `path`.
- `commit` is a full commit SHA. scilla writes the file, sorted, with `scilla review accept`; you
  don't need to edit it by hand, but it's plain JSON if you do.
- **A reviewed Reference resolves to its reviewed commit for every Consumer**, whatever its Pin
  (or the default branch) says. So `scilla add`, `scilla update` and `scilla check` only ever get
  reviewed commits, and accepting a review is how you release an update.
- A Reference without an entry floats as before (to its Pin, or the default branch's latest).
  Local References (`./vendor`) live in the Collection itself and are reviewed with it.
- A Nested Collection's References follow that Collection's own `scilla-review.json`.
- A broken `scilla-review.json` is as fatal as a broken `scilla.json`.

Inside a Collection's folder (and without `-g`), `outdated` and `diff` are the Curator's views:

```sh
scilla outdated                      # each Reference: reviewed, outdated, floating or unreachable
scilla diff                          # what accepting would release, skill by skill
scilla diff anthropics/skills/skills/pdf   # ...for one Reference, or one skill by name
scilla review accept                 # record every Reference's upstream commit as reviewed
scilla review accept acme/data-skills      # ...or just one
git commit -am "chore(review): accept upstream skill updates" && git push
```

`scilla outdated` exits `10` when a reviewed Reference moved past its reviewed commit. `scilla
review accept` with no argument also starts reviewing every floating Reference, so run it once to
opt a Collection in.

## Automating it: update pull requests

`scilla review propose` does the git work for a bot, in a checkout of the Collection:

1. It works out which reviewed References moved upstream. With none, it says so and exits 0.
2. It resets the branch `scilla/review-updates` onto the current branch, bumps those reviewed
   commits there, commits `scilla-review.json` with a Conventional message (`chore(review): bump
the reviewed commit of …`) and switches back.
3. It writes a pull request title and Markdown body to stdout, or to `--title-file` and
   `--body-file`: per Reference its commit move, the skills that changed, files that can run code,
   ratings before and after, and the diffs (capped to stay under the forges' size limits, with a
   pointer to `scilla diff` for the rest).
4. With `--open`, it force-pushes the branch to `origin` and opens a pull request for it, or
   updates the title and body of the one already open for the branch.

Without `--open`, push the branch yourself and open the pull request with `gh`, `tea` or `glab`,
using the title and body files.

### Providers and tokens

| Provider | `--provider` | API                                         | Token                               |
| -------- | ------------ | ------------------------------------------- | ----------------------------------- |
| GitHub   | `github`     | REST `POST /repos/{owner}/{repo}/pulls`     | `GITHUB_TOKEN`                      |
| Gitea    | `gitea`      | `POST /api/v1/repos/{owner}/{repo}/pulls`   | `GITEA_TOKEN`, else `FORGEJO_TOKEN` |
| Forgejo  | `forgejo`    | `POST /api/v1/repos/{owner}/{repo}/pulls`   | `FORGEJO_TOKEN`, else `GITEA_TOKEN` |
| GitLab   | `gitlab`     | `POST /api/v4/projects/{id}/merge_requests` | `GITLAB_TOKEN`, else `CI_JOB_TOKEN` |

- Without `--provider`, the provider comes from `origin`'s host: `github.com`, `gitlab.com` or a
  host with `gitlab` in its name, `codeberg.org` (Forgejo), `gitea.com`. For any other host, the
  one token variable that is set decides; pass `--provider` when that's ambiguous, as it is for a
  self-hosted Gitea or Forgejo.
- The API lives on `origin`'s host (an ssh or scp-style remote means `https://<host>`). Gitea and
  Forgejo may be served under a path (`https://example.com/git/owner/repo`). For GitHub Enterprise,
  set `GITHUB_API_URL` (GitHub Actions sets it for you).
- The token goes only to that API. A pull request opened with GitHub Actions' own `GITHUB_TOKEN`
  doesn't start other workflows; use a GitHub App or personal token if CI should run on it.
- `git commit` needs an identity: set `user.name` and `user.email` in the workflow, as the examples
  do.

### Example workflows

The scilla repo ships two, both running weekly and on demand (`workflow_dispatch`):

- [`docs/examples/scilla-review.github.yml`](https://github.com/ediiiz/scilla/blob/main/docs/examples/scilla-review.github.yml):
  copy it to `.github/workflows/scilla-review.yml`.
- [`docs/examples/scilla-review.forgejo.yml`](https://github.com/ediiiz/scilla/blob/main/docs/examples/scilla-review.forgejo.yml):
  copy it to `.forgejo/workflows/` or `.gitea/workflows/`; Forgejo and Gitea Actions accept GitHub
  Actions syntax.

Each checks out the Collection with full history, sets up Bun, sets a git identity and runs:

```sh
bunx scilla-cli review propose --open
```
