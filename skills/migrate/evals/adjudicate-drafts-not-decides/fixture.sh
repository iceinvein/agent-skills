#!/usr/bin/env bash
# A tiny-express run with the queue phase done and nothing adjudicated, so the
# next phase is adjudicate: its rulings are the owner's to make, and the agent
# drafts them for the owner rather than recording them.
#
# All four items the queued store carries stay open (the enumerate scaffold
# item plus the three extract filed), so the store matches the one every other
# express case starts from, and four is enough to test that the drafts come as
# one set.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/../lib/scaffold.sh"

migrate_scaffold tiny-express
build_express queued
