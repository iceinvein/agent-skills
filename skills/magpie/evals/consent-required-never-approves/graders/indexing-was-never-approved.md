---
type: regex
pattern: 'index approve'
match: not_contains
target: { source: file, path: .magpie-calls.log }
weight: 3
---
