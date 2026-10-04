cat > .migrate/capabilities.jsonl <<'JSONL'
{"slug":"audit-retention","title":"Audit Retention","ns":"AR","elements":["job-purge-audit-log","table-audit-log"]}
{"slug":"user-directory","title":"User Directory","ns":"UD","elements":["report-daily-users","route-get-api-users","route-post-api-users","table-users","screen-users","setting-max-users-per-page"]}
{"slug":"welcome-notification","title":"Welcome Notification","ns":"WN","elements":["route-get-api-users-id-welcome","setting-welcome-email-enabled","workflow-welcome-email","integration-mailer"]}
JSONL
cat > .migrate/seam.json <<'JSON'
{
  "validators": {
    "schema-clustering": {
      "ran": false,
      "reason": "no relational schema this run can cluster"
    },
    "call-graph": {
      "ran": false,
      "reason": "no static call-graph tooling in this environment"
    },
    "change-coupling": {
      "ran": false,
      "reason": "the copied fixture carries no VCS history"
    },
    "surface-affinity": {
      "ran": true,
      "modularity": 0.459
    }
  },
  "agreement": [
    "surface-affinity"
  ],
  "modularity": 0.459,
  "status": "accepted"
}
JSON
cat > .migrate/seam.md <<'MD'
# Seam evidence

surface-affinity clustering over the ledger refs, connected components then the
greedy modularity refinement, Q = 0.459. The other three validators could not
run: no relational schema, no static call graph, no VCS history in the copied
fixture.
MD
