---
type: regex
pattern: 'magpie (serve|render|post)|(^|\n)gh '
match: not_contains
target: { source: file, path: .magpie-calls.log }
weight: 3
---
