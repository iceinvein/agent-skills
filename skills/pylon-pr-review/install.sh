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

# Install the pr-review CLI onto PATH. Try /usr/local/bin first (no sudo
# needed if the user owns it, common on Homebrew Macs), fall back to
# ~/.local/bin (which most modern shells already have on PATH; we print a
# nudge if it isn't).
BIN_SOURCE="$SOURCE_DIR/bin/pr-review"

install_link() {
  local dest_dir="$1"
  local dest="$dest_dir/pr-review"

  if [ ! -d "$dest_dir" ]; then
    mkdir -p "$dest_dir" 2>/dev/null || return 1
  fi

  if [ ! -w "$dest_dir" ]; then
    return 1
  fi

  if [ -e "$dest" ] && [ ! -L "$dest" ]; then
    echo "  skipping $dest_dir (a non-symlink pr-review already exists there)"
    return 2
  fi

  ln -snf "$BIN_SOURCE" "$dest"
  echo "  linked  $dest -> $BIN_SOURCE"
  CLI_INSTALL_DIR="$dest_dir"
  return 0
}

echo ""
echo "Installing pr-review CLI on PATH:"

CLI_INSTALL_DIR=""
if install_link "/usr/local/bin"; then
  :
elif install_link "$HOME/.local/bin"; then
  :
else
  echo "  Could not write to /usr/local/bin or ~/.local/bin."
  echo "  Add this to your shell rc instead:"
  echo "    alias pr-review='bun $BIN_SOURCE.ts'"
  CLI_INSTALL_DIR=""
fi

if [ -n "$CLI_INSTALL_DIR" ]; then
  case ":$PATH:" in
    *":$CLI_INSTALL_DIR:"*) ;;
    *)
      echo ""
      echo "  Note: $CLI_INSTALL_DIR is not on your PATH."
      echo "  Add this to ~/.zshrc or ~/.bashrc:"
      echo "    export PATH=\"$CLI_INSTALL_DIR:\$PATH\""
      ;;
  esac
fi

echo ""
echo "Verify:"
echo "  pr-review --help"
echo "  pr-review --list-runs"
