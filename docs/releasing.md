# Releasing

Only `apps/cli` is published, as [`scilla-cli`](https://www.npmjs.com/package/scilla-cli) on npm. It bundles `@scilla/core` and `@scilla/tui`, which stay private. Versions and changelogs come from [Changesets](https://changesets.dev); publishing happens in GitHub Actions through npm [trusted publishing](https://docs.npmjs.com/trusted-publishers), so no npm token exists anywhere, and every release carries a provenance attestation.

## Contributors: add a changeset

Any PR that changes what `scilla-cli` users see needs one:

```sh
bun changeset
```

Pick `scilla-cli`, pick a bump, and write a sentence or two for users. Commit the new `.changeset/*.md` file with your PR. Docs-, test- and CI-only PRs don't need one.

## How a release happens

[`release.yml`](../.github/workflows/release.yml) runs on every push to `main`:

1. **Pending changesets:** it opens, or refreshes, a **Version packages** PR. That PR bumps `apps/cli/package.json`, writes `apps/cli/CHANGELOG.md`, deletes the consumed changesets and refreshes `bun.lock` (`bun run version-packages`).
2. **No pending changesets** (you just merged that PR): `bun run release` checks npm. If `scilla-cli@<version>` is already there, it does nothing. Otherwise it runs `bun run verify`, then `npm publish --provenance --access public` in `apps/cli`. `changesets/action` then pushes the tag `scilla-cli@<version>` and creates a GitHub release from the changelog entry.

So releasing is: merge the Version packages PR.

Publishing uses `npm`, not `bun publish`, because npm does the OIDC exchange and provenance. The job runs Node 24, whose npm is well past the 11.5.1 that trusted publishing needs (the job checks). `npm publish` runs `prepublishOnly` (the build) and `prepack`, which copies the root `README.md` into `apps/cli` for the tarball (`postpack` removes the copy). `LICENSE` is committed in both places.

The Version packages PR is opened with the workflow's own `GITHUB_TOKEN`, and GitHub doesn't start workflows for events that token causes, so **CI doesn't run on that PR by itself**. If you make CI a required check, close and reopen the PR to trigger it.

### Prereleases

Run **Actions → Release → Run workflow** on any branch. It turns that branch's pending changesets into a snapshot version such as `0.2.0-next.20260923210647` and publishes it to the `next` dist-tag (`npx scilla-cli@next`). Nothing is committed, tagged or released on GitHub. With no pending changesets, there is nothing to prerelease and the job fails with a message saying so.

### When something goes wrong

- **The publish step failed:** fix the cause and re-run the job. `bun run release` is idempotent.
- **npm has the version, but the tag or GitHub release is missing:** re-running won't create them, because the script only reports a tag for a version it has just published. Create them by hand: `git tag scilla-cli@<version> <commit> && git push origin scilla-cli@<version>`, then add a release for that tag with its `CHANGELOG.md` entry.

## One-time setup

Do these once, in order.

1. **Claim the name on npm.** Log in as `dztf` (`npm login`) and publish a placeholder `0.0.1` by hand from an empty folder:

   ```sh
   mkdir scilla-placeholder && cd scilla-placeholder
   npm init -y --init-version 0.0.1 >/dev/null
   npm pkg set name=scilla-cli description="Placeholder; the first release is 0.1.0" license=MIT
   npm publish --access public
   ```

   The repo's `apps/cli/package.json` is already at `0.0.1`, and the initial changeset (`.changeset/initial-release.md`) bumps it with a `minor`, so the first automated release is `0.1.0`. Trusted publishers can only be added to a package that exists, which is why this step comes first.

2. **Create the GitHub repo** `ediiiz/scilla`, empty for now. The `repository` fields in `apps/cli/package.json` already point at it; provenance requires that they match the repo that builds the package.

3. **Add the Trusted Publisher** on npmjs.com: [scilla-cli](https://www.npmjs.com/package/scilla-cli) → **Settings** → **Trusted Publisher** → **GitHub Actions**:
   - Organization or user: `ediiiz`
   - Repository: `scilla`
   - Workflow filename: `release.yml`
   - Environment: leave empty (the workflow uses no environment)

4. **Optional, recommended:** in the same settings page, under **Publishing access**, choose **Require two-factor authentication and disallow tokens**. Trusted publishing keeps working, and a leaked token can't publish.

5. **Let Actions open PRs:** in the GitHub repo, **Settings → Actions → General → Workflow permissions**, tick **Allow GitHub Actions to create and approve pull requests**. The default read-only token setting is fine, because the jobs ask for the permissions they need.

6. **Push `main`.** CI runs, and `release.yml` opens the Version packages PR for `0.1.0`. Merge it and `scilla-cli@0.1.0` is published, tagged and released. Afterwards you can deprecate the placeholder: `npm deprecate scilla-cli@0.0.1 "Placeholder, use 0.1.0 or later"`.
