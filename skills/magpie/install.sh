#!/usr/bin/env bash
set -euo pipefail

# This script is run by agent-skills as a postinstall step after the magpie
# skill bundle has been written to disk. Its only job is to put the magpie
# CLI on PATH and record where it linked, so uninstall.sh can clean up.

SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"
BIN_SOURCE="$SOURCE_DIR/bin/magpie"
STATE_FILE="$SOURCE_DIR/.installed-cli-path"

if [ ! -f "$BIN_SOURCE" ]; then
  echo "magpie postinstall: bin/magpie missing at $BIN_SOURCE" >&2
  exit 1
fi

chmod +x "$BIN_SOURCE" || true

# Magpie has runtime dependencies (shiki, etc.) declared in package.json.
# node_modules is not shipped via npm, so we populate it here. Use bun if
# available; fall back to a clear error otherwise.
if [ -f "$SOURCE_DIR/package.json" ] && [ ! -d "$SOURCE_DIR/node_modules" ]; then
  if command -v bun >/dev/null 2>&1; then
    echo "Installing magpie runtime dependencies..."
    (cd "$SOURCE_DIR" && bun install --production --silent) || {
      echo "magpie postinstall: bun install failed in $SOURCE_DIR" >&2
      exit 1
    }
  else
    echo "magpie postinstall: bun not found on PATH; install Bun (https://bun.sh) and rerun this script." >&2
    exit 1
  fi
fi

install_link() {
  local dest_dir="$1"
  local dest="$dest_dir/magpie"

  if [ ! -d "$dest_dir" ]; then
    mkdir -p "$dest_dir" 2>/dev/null || return 1
  fi
  if [ ! -w "$dest_dir" ]; then
    return 1
  fi
  if [ -e "$dest" ] && [ ! -L "$dest" ]; then
    echo "  skipping $dest_dir (a non-symlink magpie already exists there)"
    return 2
  fi

  ln -snf "$BIN_SOURCE" "$dest"
  echo "  linked  $dest -> $BIN_SOURCE"
  printf '%s\n' "$dest" > "$STATE_FILE"
  return 0
}

echo "Installing magpie CLI on PATH:"

CLI_INSTALL_DIR=""
if install_link "/usr/local/bin"; then
  CLI_INSTALL_DIR="/usr/local/bin"
elif install_link "$HOME/.local/bin"; then
  CLI_INSTALL_DIR="$HOME/.local/bin"
else
  echo "  Could not write to /usr/local/bin or ~/.local/bin."
  echo "  Add this alias to your shell rc instead:"
  echo "    alias magpie='bun $BIN_SOURCE.ts'"
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
echo "  magpie --help"
echo "  magpie --list-runs"
