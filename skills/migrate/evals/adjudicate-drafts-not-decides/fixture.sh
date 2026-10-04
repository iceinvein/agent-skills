#!/usr/bin/env bash
# A tiny-express run with the queue phase done and nothing adjudicated, so the
# next phase is adjudicate: its rulings are the owner's to make, and the agent
# drafts them for the owner rather than recording them.
#
# The plan called for three open items. The queued store as built carries
# four (the enumerate scaffold item plus the three extract filed), and all four
# are left open: trimming one would mean a fixture-only edit to a store the
# express steps otherwise build verbatim, and four still tests that the drafts
# come as one set.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/../lib/scaffold.sh"

migrate_scaffold tiny-express
build_express queued
