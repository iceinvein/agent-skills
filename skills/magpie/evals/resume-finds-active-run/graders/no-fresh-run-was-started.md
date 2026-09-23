---
type: regex
pattern: 'magpie setup'
match: not_contains
target: { source: file, path: .magpie-calls.log }
weight: 3
---
