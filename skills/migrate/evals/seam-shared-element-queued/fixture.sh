#!/usr/bin/env bash
# A tiny-webforms run stopped at the seam phase: probed and enumerated through
# the real CLI with --source-stack aspnet-webforms, every element unaccounted,
# carrying exactly the ledger refs scripts/__tests__/e2e-webforms.test.ts
# records (ten edges), enumerate done, seam pending.
#
# seam.md's second worked example is this partition. Of the four edgeless
# elements, three have a home by source proximity; setting-default-connection
# does not (it is read by code serving three of the four capabilities), so the
# seam owes a queue item for it and leaves it out of every capability.
#
# The elements and lens census records live in enumerate/ beside this script;
# the census directions are the aspnet.md probes the e2e test records.
set -euo pipefail

CASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$CASE_DIR/../lib/scaffold.sh"

migrate_scaffold tiny-webforms

export PATH="$HOME/shims:$PATH"
migrate init --source "$PWD/legacy" --scope 'the whole tiny webforms app' --name webforms-next --source-stack aspnet-webforms
migrate phase probe --status done
_migrate_eval_commit "migrate: probe"

migrate import elements "$CASE_DIR/enumerate/elements.json"
for surface in routes tables jobs reports screens integrations workflows settings; do
  migrate census "$CASE_DIR/enumerate/census-$surface.json"
done
migrate phase enumerate --status done
# Seam has not run, so the partition file is empty: the same state
# `migrate reset --phase seam` leaves, and a real file for the graders to read.
: > .migrate/capabilities.jsonl
_migrate_eval_commit "migrate: enumerate"
