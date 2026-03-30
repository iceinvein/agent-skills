#!/bin/bash
set -euo pipefail

# Usage: ./scripts/release.sh [patch|minor|major]
# Defaults to patch if no argument given

BUMP="${1:-patch}"

if [[ "$BUMP" != "patch" && "$BUMP" != "minor" && "$BUMP" != "major" ]]; then
  echo "Usage: ./scripts/release.sh [patch|minor|major]"
  exit 1
fi

# Ensure working tree is clean
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: working tree is not clean. Commit or stash changes first."
  exit 1
fi

# Ensure we're on master
BRANCH="$(git branch --show-current)"
if [[ "$BRANCH" != "master" && "$BRANCH" != "main" ]]; then
  echo "Error: must be on master or main branch (currently on '$BRANCH')"
  exit 1
fi

# Run tests
echo "Running tests..."
bun test

# Bump version in package.json (no git tag — we do it manually)
NEW_VERSION="$(npm version "$BUMP" --no-git-tag-version)"
echo "Bumped to $NEW_VERSION"

# Commit and tag
git add package.json
git commit -m "release: $NEW_VERSION"
git tag "$NEW_VERSION"

# Push commit and tag
git push && git push origin "$NEW_VERSION"

echo ""
echo "Released $NEW_VERSION — GitHub Actions will publish to npm."
