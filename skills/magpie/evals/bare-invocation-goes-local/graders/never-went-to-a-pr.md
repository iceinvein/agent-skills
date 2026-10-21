---
type: regex
pattern: 'magpie setup .*--pr|(^|\n)gh '
match: not_contains
target: { source: file, path: .magpie-calls.log }
weight: 2
---
