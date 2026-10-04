#!/usr/bin/env bash
# The tiny-express run with seam done, plus one route nothing reaches: an
# admin router in app.js that registers GET /admin/audit-log/export and is
# never mounted with app.use, linked from no view and called by nothing. It is
# in the ledger as route-get-admin-audit-log-export (unaccounted, ref to
# table-audit-log), the routes lens census is re-recorded at four, and the
# seam partition puts it in audit-retention beside the purge job and the table.
#
# Extract over audit-retention has to dispose of it. Every other element still
# carries the enumerate placeholder out-of-scope citing
# q-tiny-express-enumerate-scaffold, so the graders look for an out-of-scope
# disposition on this element citing some other queue item, a queue item the
# run created, and no check that saw the disposition's queue id dangling.
set -euo pipefail

CASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$CASE_DIR/../lib/scaffold.sh"

migrate_scaffold tiny-express
build_express seamed

# Inserted above app.js's closing module.exports, its last line.
app="$PWD/legacy/app.js"
total="$(wc -l < "$app")"
{
  head -n "$((total - 1))" "$app"
  cat "$CASE_DIR/enumerate/admin-router.js"
  tail -n 1 "$app"
} > "$PWD/app.js.new"
mv "$PWD/app.js.new" "$app"

export PATH="$HOME/shims:$PATH"
migrate import elements "$CASE_DIR/enumerate/elements-dead-route.json"
migrate census "$CASE_DIR/enumerate/census-routes.json"

cat > .migrate/capabilities.jsonl <<'JSONL'
{"slug":"audit-retention","title":"Audit Retention","ns":"AR","elements":["job-purge-audit-log","table-audit-log","route-get-admin-audit-log-export"]}
{"slug":"user-directory","title":"User Directory","ns":"UD","elements":["report-daily-users","route-get-api-users","route-post-api-users","table-users","screen-users","setting-max-users-per-page"]}
{"slug":"welcome-notification","title":"Welcome Notification","ns":"WN","elements":["route-get-api-users-id-welcome","setting-welcome-email-enabled","workflow-welcome-email","integration-mailer"]}
JSONL
_migrate_eval_commit "migrate: admin export route enumerated and seamed into audit-retention"
