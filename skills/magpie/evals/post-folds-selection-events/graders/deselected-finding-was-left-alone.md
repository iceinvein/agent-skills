---
type: regex
pattern: 'security-1'
match: not_contains
target: { source: file, path: .magpie-calls.log }
weight: 3
---
