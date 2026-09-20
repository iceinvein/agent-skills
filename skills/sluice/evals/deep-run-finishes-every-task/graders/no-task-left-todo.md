---
type: regex
pattern: '"status":\s*"(todo|active|blocked)"'
match: not_contains
target: { source: file, path: .sluice/run.json }
weight: 3
---
