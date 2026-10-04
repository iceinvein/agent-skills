---
id: q-express-user-list-source
severity: moderate
status: open
---

## Evidence

`app.js:8` answers `GET /api/users` with `[].slice(0, settings.maxUsersPerPage)`:
a literal empty array, capped at the configured page size. Nothing anywhere
in the checkout opens a database connection or reads the `users` table that
`schema.sql:1-5` declares.

## Options

(a) Treat the endpoint as a stub and write the requirement against the table
the schema declares. (b) Treat the empty list as the real behavior and
record that the table is unread. (c) Ask the operator which one production
actually served.

## Recommendation

Recommend (c); the route and the schema disagree about whether this endpoint
has a data source, and nothing in the source settles it either way.
