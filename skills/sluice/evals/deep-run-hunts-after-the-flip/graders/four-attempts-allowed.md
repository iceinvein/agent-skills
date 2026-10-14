---
type: llm
# A regex over the loop accepts one spelling of the fix and rejects the rest
# (a for loop, a helper, a counter that starts at zero), so the judge reads the
# code and works the cases. The spec puts the number in MAX_ATTEMPTS alone, so
# a fix that raised the constant instead leaves this file buggy and fails here.
focus: { source: file, path: src/cli/deploy.js }
weight: 3
---

This is `src/cli/deploy.js` after the run. It imports `MAX_ATTEMPTS` from
`src/cli/retry-policy.js`; take its value as 4, which the spec fixes. The spec
says a failed step is retried up to three times, so it runs at most four times
in all; when the fourth attempt fails the deploy stops with
`step <name> failed after 4 attempts` and runs no later step.

The fixture's loop gave up when `attempt >= MAX_ATTEMPTS - 1`, so a step ran
three times at most and the error said `after 3 attempts`.

Work out, reading the code as written, what happens when `runStep` throws on
`upload`:

- it throws three times and then succeeds: the deploy must finish and log
  `deployed: 3 steps`
- it always throws: `upload` must run exactly four times, the error must read
  `step upload failed after 4 attempts`, and `activate` must never run

PASS if the code does all of that.
FAIL if a step that fails three times stops the deploy, if a step that always
fails runs any number of times other than four, if the error names another
count, or if a later step runs after a step gave up.
