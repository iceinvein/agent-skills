---
type: regex
# The files target lists only created paths, and src/paging.js is the
# scaffold's, so its content is read directly. Rounding up is accepted in
# either common spelling, Math.ceil or the integer (total + size - 1) form,
# inside lastPage's own body; the fixture's Math.floor(total / size) matches
# neither.
pattern: 'function\s+lastPage\s*\([^)]*\)\s*\{[^}]*?(?:Math\.ceil\s*\(|\+\s*size\s*-\s*1\b)'
target: { source: file, path: src/paging.js }
weight: 2
---
