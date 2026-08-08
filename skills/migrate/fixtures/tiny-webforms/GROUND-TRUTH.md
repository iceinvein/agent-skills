# Ground truth for tiny-webforms

Sixteen elements across all eight default surfaces. Any enumeration run over
this fixture must find exactly these, and the census must balance at these
totals: 5 routes, 2 tables, 1 job, 1 report, 2 screens, 1 integration, 1
workflow, 3 settings.

| surface | id | element |
| --- | --- | --- |
| routes | route-get-api-users | GET api/users |
| routes | route-post-api-users | POST api/users |
| routes | route-get-api-users-id-welcome | GET api/users/{id}/welcome |
| routes | route-default-aspx | Default.aspx |
| routes | route-users-aspx | Users.aspx |
| tables | table-users | Users |
| tables | table-audit-log | AuditLog |
| jobs | job-nightly-digest | nightly purge of AuditLog rows older than the configured cutoff |
| reports | report-daily-users | daily active users report |
| screens | screen-default | signup screen (Default.aspx) |
| screens | screen-users | users list and welcome screen (Users.aspx) |
| integrations | integration-billing-sync | outbound call to the billing system on activation |
| workflows | workflow-signup-welcome | two-page signup then welcome workflow |
| settings | setting-welcome-email-enabled | WelcomeEmailEnabled |
| settings | setting-nightly-digest-cutoff-days | NightlyDigestCutoffDays |
| settings | setting-default-connection | DefaultConnection |

## Element-to-element touches

Six of these elements touch another element already in this table, the
kind of touch `references/phases/enumerate.md`'s Procedure (step 4) tells a
lens to record as a `{"kind": "ledger", "id": ...}` ref, and the only edge
data `references/phases/seam.md`'s surface-affinity clustering has to
build a graph from. Kept here as prose, not as a fourth table column,
because unlike the census columns above nothing parses this: the e2e test
records these refs by hand against the ids above, the same way a real
lens would, rather than by reading this section.

- `route-get-api-users` reads `table-users`.
- `route-post-api-users` writes `table-users`.
- `route-get-api-users-id-welcome` notifies `integration-billing-sync`.
- `job-nightly-digest` purges `table-audit-log`.
- `report-daily-users` queries `table-users`.
- `workflow-signup-welcome` spans `route-post-api-users`,
  `route-get-api-users-id-welcome`, and `setting-welcome-email-enabled`.
