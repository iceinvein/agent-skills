---
type: regex
# The deploy test is the one place the new line must appear as a literal: the
# source can build it with a join, but the existing test pins `deployed: 3
# steps`, so a green suite needs this test updated to the new line. Without
# this grader a run that changes nothing scores on status-test-unchanged.
pattern: 'deployed: build, upload, activate'
target: { source: file, path: tests/deploy.test.js }
---
