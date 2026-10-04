---
id: q-express-users-table-unwired
severity: moderate
status: open
---

## Evidence

The `read-write-symmetry` closer checked every write path against a matching
read path. `schema.sql:1-5` declares a `users` table;
`reports/daily-users.json:4` reads it; nothing in `app.js` or `cron.js`
writes to it, and `POST /api/users` at `app.js:10-14` persists nothing at
all beyond an in-memory map entry.

## Options

(a) Treat the table as write-only-by-something-outside-this-checkout and
widen the search. (b) Treat it as a real gap for the target to fix rather
than replicate. (c) Ask the operator whether user rows were ever written by
this application.

## Recommendation

Recommend (c); a table with a reader and no writer anywhere in the checkout
is exactly what this closer exists to surface, and only the operator can say
whether the writer is missing or merely elsewhere.
