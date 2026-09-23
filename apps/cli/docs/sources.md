# Sources

A source names where skills come from. It's the argument of `scilla add` and `scilla ref add`, and
each entry of `references` in `scilla.json`.

| Source                                   | Meaning                                             |
| ---------------------------------------- | --------------------------------------------------- |
| `owner/repo`                             | A GitHub repo (`https://github.com/owner/repo.git`) |
| `owner/repo/path/to/folder`              | A folder inside it                                  |
| `owner/repo@skill-name`                  | Only the skill with that name                       |
| `owner/repo#v1.2.0`                      | Pinned to a tag, branch or commit                   |
| `owner/repo/skills@pdf#main`             | All of the above at once                            |
| `https://github.com/owner/repo#ref`      | The same GitHub repo as `owner/repo`                |
| `https://host/group/repo.git#ref`        | Any git URL                                         |
| `git@host:group/repo.git`, `ssh://…`     | SSH URLs                                            |
| `file:///srv/skills.git`                 | A repo on disk, fetched through git                 |
| `./vendor/skills`, `../x`, `/abs`, `~/x` | A local folder, read in place without git           |

## The rules

- **GitHub shorthand**: `owner/repo[/path][@name][#ref]`. Owner and repo are letters, digits, `_`,
  `.` and `-`.
- **Git URL**: anything containing `://`, starting with `git@`, or ending in `.git`, with an
  optional `#ref`. A git URL can't carry a path or `@name` inline; in `scilla.json` use the object
  form's `path` field (see `scilla docs manifest`).
- **GitHub URL**: `https://github.com/owner/repo`, with or without `.git` and a trailing slash,
  counts as GitHub: it's the same repo as `owner/repo`, installed under the same key, and it gets
  security ratings (see `scilla docs audit`). An SSH URL such as `git@github.com:owner/repo.git`
  stays a plain git URL and is fetched over SSH.
- **Local folder**: `.`, `..`, `~`, or a path starting with `/`, `./`, `../` or `~/`. `@name` works
  here too. Relative paths resolve against the current directory for `add`, and against the
  Collection's folder inside `scilla.json`. `~` is your home directory. A local source has no
  commit: it's recorded as `local`.
- **`#ref`** is a Pin: any git ref, resolved to a commit with `git rev-parse <ref>^{commit}`. The
  last `#` in the source starts it, and it can't be empty. Without one, the default branch's `HEAD`
  is used.
- **`@name`** keeps only the skill with that name. It's matched against skill names (frontmatter
  `name`, else the folder name), not folder paths.

## Inside a fetched Collection

In a Collection fetched with git, a local path such as `./vendor` means that folder of the same
repo at the same commit. Absolute paths, `~` and `..` that would leave the repo are refused with a
warning, so a remote Collection can't read your disk. A Reference whose source doesn't parse is a
warning too; its skills are missing.

## Fetching

scilla runs your own `git`, so SSH keys, credential helpers and `gh auth` all apply. Repos are
mirrored under `$SCILLA_CACHE_DIR`, else `$XDG_CACHE_HOME/scilla`, else `~/.cache/scilla`, and each
repo is fetched at most once per run. When a fetch fails but a cached mirror exists, scilla warns
and uses the cache. A git failure is shown in one line; set `SCILLA_DEBUG=1` to see git's full
output.
