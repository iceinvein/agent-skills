#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET="$HOME/.claude/skills/pylon-pr-review"

if [ -e "$TARGET" ] && [ ! -L "$TARGET" ]; then
  echo "Refusing to overwrite non-symlink at $TARGET"
  echo "Remove or move it manually, then re-run."
  exit 1
fi

mkdir -p "$HOME/.claude/skills"
ln -snf "$SOURCE_DIR" "$TARGET"

echo "Installed pylon-pr-review skill at $TARGET"
echo ""
echo "Verify:"
echo "  ls -l $TARGET"
echo "  bun $TARGET/bin/pr-review.ts --help"
