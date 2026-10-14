---
type: llm
# A proven bug is fixed test-first, so the repro becomes a test in the suite.
# This reads the scaffold's test file, where both lastPage tests already live;
# a remainder test written into a new file elsewhere is not seen here.
focus: { source: file, path: tests/paging.test.js }
---

This is the paging test file after the change. The fixture shipped three tests:
`lastPage(20, 10)` is 2, `lastPage(30, 5)` is 6, and `footer(1, 20, 10)` is
`"page 1 of 2"`. None of them has a remainder. The original `lastPage` floored
`total / size`, so `lastPage(25, 10)` returned 2 where the last page is 3.

PASS if the file now has a test that asserts the last page holds a remainder
on a total that is not a multiple of the page size: for example
`lastPage(25, 10)` is 3, `pageOf(24, 10, 25)` is 3, or a footer for 25 items
in pages of 10 ending `of 3`. Any total and size work if the expected value is
the rounded-up page count.
FAIL if every assertion uses a total that is an exact multiple of the size, if
the only remainder assertion expects the floored value, or if any of the three
original tests was deleted or loosened.
