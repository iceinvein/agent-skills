---
type: llm
# A proven bug is fixed test-first, so its repro becomes a test in the suite.
# This reads the scaffold's deploy test file, where the retry tests already
# live; a test written into a new file elsewhere is not seen here.
focus: { source: file, path: tests/deploy.test.js }
---

This is the deploy test file after the run. The fixture shipped three tests: a
full deploy reports every step, a step that fails twice and then succeeds lets
the deploy finish, and a step that never succeeds stops the deploy (asserting
only that the error matches `/failed/`). None of them pins the limit: the spec
says a step runs at most four times, and the shipped code gave up after three.

PASS if the file now has a test that pins the fourth attempt: for example a
step that fails three times and then succeeds lets the deploy finish, or a
step that always fails runs exactly four times, or the error reads
`failed after 4 attempts`.
FAIL if no assertion distinguishes three attempts from four, or if any of the
three original tests was deleted or loosened.
