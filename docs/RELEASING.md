# Releasing

How `@iceinvein/agent-skills` ships to npm.

## TL;DR

```bash
# 1. From a clean master, bump any skills whose contents changed since last tag
bun run skill:bump:check      # see what would bump
bun run skill:bump:all        # writes new versions into skills/*/skill.json
git commit -am "chore: bump skill versions"

# 2. Cut a release (patch by default)
bun run release               # or: bun run release minor / major
```

The `release` script tags `vX.Y.Z` and pushes. GitHub Actions does the actual npm publish.

## Two version namespaces

There are two independent version streams in this repo, and you bump them separately:

1. **Package version** (`package.json` → `version`): the npm package as a whole. Consumers see this when they `bun add @iceinvein/agent-skills`.
2. **Skill versions** (`skills/*/skill.json` → `version`): per-skill. Used by the CLI to detect updates and drive `bump --all`'s "is anything stale?" check.

A release bumps the package version. Skill versions are bumped whenever a skill's contents change, ideally in the same commit as the change. The release script refuses to proceed if it finds skills with content changes since the last tag but no version bump (see `bump --all --dry-run`).

## Skill version bumping

Run before committing skill changes (or before releasing, if you forgot):

```bash
bun run skill:bump:check                       # dry run, list stale skills
bun run skill:bump:all                         # patch-bump all stale skills
bun run src/cli/index.ts bump <name> minor     # one skill, specific level
```

How "stale" is detected (see `src/cli/commands/bump.ts`):

- Walks `git diff <latest-tag>..HEAD -- skills/` to find skills with file changes since the last release tag.
- Skips skills that didn't exist at the last tag (newly added skills don't need a bump on first release).
- Skips skills whose `skill.json` already shows a `version` line change in the diff (already bumped).

Pick the bump level by impact:

| Level | When |
|-------|------|
| patch | Wording tweaks, typos, internal refactors, small bug fixes inside a skill |
| minor | New capability, new option, expanded scope, additive change |
| major | Breaking change to skill behavior, removed capability, renamed activation hook |

## Cutting a release

`scripts/release.sh` (also `bun run release`) does the following:

1. Verifies working tree is clean.
2. Verifies branch is `master` (or `main`).
3. Runs `bun test`.
4. Runs `bun run skill:bump:check` and aborts if any skill is stale.
5. `npm version <patch|minor|major> --no-git-tag-version` to bump `package.json`.
6. Commits with message `release: vX.Y.Z`.
7. Creates tag `vX.Y.Z`.
8. Pushes the commit and the tag to `origin`.

Usage:

```bash
bun run release            # patch (default)
bun run release minor
bun run release major
```

After the push, `.github/workflows/publish.yml` takes over.

## What CI does on tag push

Trigger: any `v*` tag pushed to `origin`. Defined in `.github/workflows/publish.yml`.

Steps:

1. `actions/checkout@v6`
2. `oven-sh/setup-bun@v2`
3. `bun install`
4. `bun test`
5. `bun build src/cli/index.ts --outdir dist/cli --target node` (note: `target node` in CI; local `build` script uses `target bun`. The published artifact is the node build.)
6. Downloads npm 11 tarball directly and runs `npm publish --provenance --access public`. This sidesteps a broken bundled npm in the setup-node image.

Publish uses OIDC (`id-token: write` in workflow permissions) so no `NPM_TOKEN` secret is needed. The provenance attestation is what makes the npm page show the green "Provenance" badge.

The `files` field in `package.json` controls what ships: `dist/` and `skills/`. Source under `src/`, tests, and docs are not published.

## Recovery

**CI failed after the tag was pushed.**
Investigate the workflow run. Common causes: a flaky test, npm transient error.

- If the publish step itself failed but tests passed, you can re-run the failed jobs from the GitHub Actions UI. The tag is already pushed, so the workflow will rerun on the same ref.
- If a real bug needs fixing, do not re-tag the same version. Bump again (`bun run release patch`) and ship the next version. npm versions are immutable.

**You tagged the wrong version locally and haven't pushed yet.**

```bash
git tag -d vX.Y.Z
git reset --hard HEAD~1     # only if the release commit is the tip and unpushed
```

**You pushed a tag you didn't mean to.**
Do not delete a published tag once npm has the version. If npm publish hasn't happened yet (workflow still running or failed before publish), you may delete the remote tag and re-tag:

```bash
git push --delete origin vX.Y.Z
git tag -d vX.Y.Z
```

Once `npm publish` has succeeded, the version exists forever; ship the next patch instead.

**Skill bump check blocks the release.**
The script will list the skills that need bumping. Run `bun run skill:bump:all`, commit, and rerun `bun run release`.

## Quick checklist

- [ ] On `master`, clean tree, up to date with origin
- [ ] `bun test` green
- [ ] `bun run skill:bump:check` clean (or bumps committed)
- [ ] Decide patch / minor / major for the package
- [ ] `bun run release [level]`
- [ ] Watch the Actions run; confirm the npm page shows the new version
