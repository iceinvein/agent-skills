#!/usr/bin/env bash
# A fresh run: the tiny-express source at ./legacy, the workspace a git repo,
# and no .migrate store yet. Probe is the only phase that interviews the
# operator, and nothing in the source says what the target is, so the run
# should write what it can detect (config.toml through init, parity-basis.md
# by hand) and then ask for the target stack, layout and commands rather than
# fill them in itself.
set -euo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/../lib/scaffold.sh"
migrate_scaffold tiny-express
