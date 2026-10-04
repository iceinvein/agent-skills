#!/usr/bin/env bash
# A run interrupted part way through extract. Probe, enumerate and seam are
# done; extract is running with one of the three capabilities (audit-retention)
# mined: its two requirements imported and its two elements disposed, each
# batch committed as run-ops.md's checkpoint loop does. The other two
# capabilities are untouched. A resume should read where the run stopped from
# the store (migrate status, migrate phase) before writing anything, and must
# never re-run init over a live store.
#
# The two batches are cut from the express step files rather than typed here,
# so they stay the same rows the full replay imports.
set -euo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/../lib/scaffold.sh"
migrate_scaffold tiny-express
build_express seamed

batches="$(mktemp -d)"
trap 'rm -rf "$batches"' EXIT

python3 - "$MIGRATE_SKILL_ROOT/evals/lib/express" "$batches" <<'PY'
import json, pathlib, sys

steps, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
cap_elements = {'job-purge-audit-log', 'table-audit-log'}

reqs = json.loads((steps / '23-import-reqs-extract.json').read_text())
reqs['batch'] = 'b-reqs-extract-audit-retention-001'
reqs['rows'] = [r for r in reqs['rows'] if r['cap'] == 'audit-retention']
assert len(reqs['rows']) == 2, reqs['rows']
(out / 'reqs.json').write_text(json.dumps(reqs, indent=2))

elements = json.loads((steps / '27-import-elements-disposed.json').read_text())
elements['batch'] = 'b-elements-disposition-audit-retention-001'
elements['rows'] = [r for r in elements['rows'] if r['id'] in cap_elements]
assert len(elements['rows']) == 2, elements['rows']
(out / 'elements.json').write_text(json.dumps(elements, indent=2))
PY

export PATH="$HOME/shims:$PATH"
migrate import reqs "$batches/reqs.json"
_migrate_eval_commit "migrate: audit-retention requirements"
migrate import elements "$batches/elements.json"
_migrate_eval_commit "migrate: audit-retention dispositions"
