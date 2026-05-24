#!/usr/bin/env bash
set -euo pipefail

# Run by agent-skills as a postremove step before the magpie skill bundle is
# deleted. Reads the path recorded by install.sh and removes the PATH symlink
# if it still points back into this bundle.

SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"
STATE_FILE="$SOURCE_DIR/.installed-cli-path"

if [ ! -f "$STATE_FILE" ]; then
  exit 0
fi

CLI_PATH="$(head -n 1 "$STATE_FILE")"
[ -z "$CLI_PATH" ] && exit 0

if [ -L "$CLI_PATH" ]; then
  TARGET="$(readlink "$CLI_PATH")"
  case "$TARGET" in
    "$SOURCE_DIR"/*)
      rm -f "$CLI_PATH"
      echo "Removed magpie CLI symlink at $CLI_PATH"
      ;;
    *)
      echo "magpie uninstall: leaving $CLI_PATH alone (points to $TARGET, not this bundle)"
      ;;
  esac
fi

rm -f "$STATE_FILE"
