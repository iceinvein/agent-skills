#!/usr/bin/env bash
# A tiny-express run handed off through the markdown adapter, with no coverage
# or forecast run since and no .migrate/forecast-assumptions.md. Forecast needs
# that file attested by the owner, so the agent has to ask for the assumptions
# rather than write them itself or quote a delivery date it made up.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/../lib/scaffold.sh"

migrate_scaffold tiny-express
build_express handed-off
