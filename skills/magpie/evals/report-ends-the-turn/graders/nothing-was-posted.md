---
type: regex
pattern: 'magpie post|gh (pr comment|api)'
match: not_contains
target: { source: file, path: .magpie-calls.log }
weight: 3
---
