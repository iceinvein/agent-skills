---
type: regex
# As source-unchanged: a repro appended to the scaffold's own test file is an
# edit, which the files target never lists. The scaffold has two tests, so a
# third means the hunt wrote into the caller's suite.
pattern: '\b(?:test|it)\('
match: 'count:2'
target: { source: file, path: tests/backoff.test.js }
weight: 3
---
