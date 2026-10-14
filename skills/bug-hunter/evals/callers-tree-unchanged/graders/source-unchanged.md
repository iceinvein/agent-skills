---
type: regex
# tree-unchanged reads the files target, which lists only paths Claude
# created, so an edit to a scaffold file never reaches it. A fix made in place
# would rewrite the buggy line, so its survival is what shows src/backoff.js
# was left alone.
pattern: 'return Math\.min\(BASE_MS \* 2 \*\* attempt, MAX_MS\);'
target: { source: file, path: src/backoff.js }
weight: 3
---
