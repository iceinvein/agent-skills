#!/usr/bin/env bash
# A run stopped at the seam phase over a source with no seam in it: this case's
# own legacy/ (one server.js whose four routes and one cron job each read all
# three tables, and a schema.sql with no foreign keys), probed and enumerated
# through the real CLI, enumerate done, seam pending. The honest seam answer is
# escalation to the queue, not a partition.
#
# Why no validator can agree on a partition here:
# - schema clustering: no foreign keys, so the three tables share no edge.
# - call graph: one module, and every handler touches every table.
# - change coupling: the source carries no .git (config.toml says vcs none).
# - surface affinity: every non-table element refs every table, so the graph is
#   the complete bipartite K(5,3), m = 15. Components-only Q = 0.000 (one
#   component). Greedy refinement from singletons starts at Q = -0.133 and
#   climbs through seven merges back to the single community at Q = 0.000.
#   For any community holding a share x of the five and y of the three, its
#   term is xy - ((x+y)/2)^2 = -((x-y)/2)^2 <= 0, so no partition of this graph
#   can score above 0, let alone the 0.3 floor.
#
# migrate_scaffold builds the binary and the git repo around tiny-express; that
# source is swapped for this case's own and committed before anything is run.
set -euo pipefail

CASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$CASE_DIR/../lib/scaffold.sh"

migrate_scaffold tiny-express

rm -rf "$PWD/legacy"
mkdir "$PWD/legacy"
cp -R "$CASE_DIR/legacy/." "$PWD/legacy/"
rm -rf "$PWD/legacy/.git"
_migrate_eval_commit "scaffold: billing source"

export PATH="$HOME/shims:$PATH"
migrate init --source "$PWD/legacy" --scope 'the whole billing app' --name billing-next --source-stack express
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
