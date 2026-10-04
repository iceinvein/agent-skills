#!/usr/bin/env bash
# A run that looks finished: every phase through handoff is marked done and
# the work items were emitted. After handoff, the one sanctioned delta
# (delta-mailer-provider-swap) was re-imported with its owner signature
# cleared, as a revised delta waiting on sign-off would be. Every phase still
# reads done, so `migrate phase` says nothing is left and `migrate status`
# ends on "resume: all phases done"; only `migrate check`, which prints the
# deltas gate's violation and exits 1, says otherwise.
# Asked whether the mapping is finished, the run should answer from plain
# `migrate check` (SKILL.md: its exit 0 is what "mapped" means), not from the
# phase table or a --phase check.
#
# The batch is cut from the express parity step rather than typed here, so it
# is the same row the full replay signed.
set -euo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/../lib/scaffold.sh"
migrate_scaffold tiny-express
build_express handed-off

batches="$(mktemp -d)"
trap 'rm -rf "$batches"' EXIT

python3 - "$MIGRATE_SKILL_ROOT/evals/lib/express/36-import-deltas-parity.json" "$batches/deltas.json" <<'PY'
import json, pathlib, sys

batch = json.loads(pathlib.Path(sys.argv[1]).read_text())
assert [r['id'] for r in batch['rows']] == ['delta-mailer-provider-swap'], batch['rows']
batch['batch'] = 'b-deltas-parity-002'
batch['rows'][0]['owner_signed'] = None
pathlib.Path(sys.argv[2]).write_text(json.dumps(batch, indent=2))
PY

export PATH="$HOME/shims:$PATH"
migrate import deltas "$batches/deltas.json"
# Named like every other checkpoint, so the history does not hand over the
# answer the check is supposed to give.
_migrate_eval_commit "migrate: b-deltas-parity-002"
