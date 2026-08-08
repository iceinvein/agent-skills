# Ground truth for tiny-express

Twelve elements across all eight default surfaces. Any enumeration run over
this fixture must find exactly these, and the census must balance at these
totals: 3 routes, 2 tables, 1 job, 1 report, 1 screen, 1 integration, 1
workflow, 2 settings.

| surface | id | element |
| --- | --- | --- |
| routes | route-get-api-users | GET /api/users |
| routes | route-post-api-users | POST /api/users |
| routes | route-get-api-users-id-welcome | GET /api/users/:id/welcome |
| tables | table-users | users |
| tables | table-audit-log | audit_log |
| jobs | job-purge-audit-log | nightly purge of audit_log |
| reports | report-daily-users | daily-users report |
| screens | screen-users | users list screen |
| integrations | integration-mailer | call to mailer service |
| workflows | workflow-welcome-email | welcome email workflow |
| settings | setting-welcome-email-enabled | welcomeEmailEnabled |
| settings | setting-max-users-per-page | maxUsersPerPage |

## Element-to-element touches

Four of these elements touch another element already in this table, the
kind of touch `references/phases/enumerate.md`'s Procedure (step 4) tells a
lens to record as a `{"kind": "ledger", "id": ...}` ref, and the only edge
data `references/phases/seam.md`'s surface-affinity clustering has to
build a graph from. Kept here as prose, not as a fourth table column,
because unlike the census columns above nothing parses this: the e2e test
records these refs by hand against the ids above, the same way a real
lens would, rather than by reading this section.

- `route-get-api-users` reads `table-users`.
- `route-post-api-users` writes `table-users`.
- `job-purge-audit-log` purges `table-audit-log`.
- `report-daily-users` queries `table-users`.
- `workflow-welcome-email` spans `route-post-api-users`,
  `route-get-api-users-id-welcome`, and `setting-welcome-email-enabled`.
