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
