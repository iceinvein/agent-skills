---
type: llm
# A regex over the source accepts one spelling of rounding up and rejects the
# rest (a guard block, an arrow function, floor plus a remainder check), so
# the judge reads the helper and works the numbers. The files target lists
# only created paths, and src/paging.js is the scaffold's, so it is read here.
focus: { source: file, path: src/paging.js }
weight: 2
---

This is `src/paging.js` after the change. Pages are 1-based and hold `size`
items each. The fixture's `lastPage(total, size)` returned
`Math.floor(total / size)`, so `lastPage(25, 10)` returned 2 where the last
page, which holds the remaining five items, is page 3.

Work out what the `lastPage` in this file returns for these calls, reading the
code as written:

- `lastPage(25, 10)` must be 3
- `lastPage(20, 10)` must be 2
- `lastPage(30, 5)` must be 6
- `lastPage(1, 10)` must be 1

PASS if `lastPage` returns every value above, each as an integer (not 2.5 or
any other fraction).
FAIL if any call returns a different value or a non-integer, or if `lastPage`
is no longer exported from this file.
