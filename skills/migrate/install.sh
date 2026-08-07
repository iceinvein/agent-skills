#!/usr/bin/env bash
set -euo pipefail

# This script is run by agent-skills as a postinstall step after the migrate
# skill bundle has been written to disk. Its only job is to put the migrate
# CLI on PATH and record where it linked, so uninstall.sh can clean up.

SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"
BIN_SOURCE="$SOURCE_DIR/bin/migrate"
STATE_FILE="$SOURCE_DIR/.installed-cli-path"

if [ ! -f "$BIN_SOURCE" ]; then
  echo "migrate postinstall: bin/migrate missing at $BIN_SOURCE" >&2
  exit 1
fi

chmod +x "$BIN_SOURCE" || true

install_link() {
  local dest_dir="$1"
  local dest="$dest_dir/migrate"

  if [ ! -d "$dest_dir" ]; then
    mkdir -p "$dest_dir" 2>/dev/null || return 1
  fi
  if [ ! -w "$dest_dir" ]; then
    return 1
  fi
  if [ -e "$dest" ] && [ ! -L "$dest" ]; then
    echo "  skipping $dest_dir (a non-symlink migrate already exists there)"
    return 2
  fi

  ln -snf "$BIN_SOURCE" "$dest"
  echo "  linked  $dest -> $BIN_SOURCE"
  printf '%s\n' "$dest" > "$STATE_FILE"
  return 0
}

echo "Installing migrate CLI on PATH:"

CLI_INSTALL_DIR=""
if install_link "/usr/local/bin"; then
  CLI_INSTALL_DIR="/usr/local/bin"
elif install_link "$HOME/.local/bin"; then
  CLI_INSTALL_DIR="$HOME/.local/bin"
else
  echo "  Could not write to /usr/local/bin or ~/.local/bin."
  echo "  Add this alias to your shell rc instead:"
  echo "    alias migrate='bun $BIN_SOURCE.ts'"
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
echo "  migrate --version"
echo "  migrate --help"
