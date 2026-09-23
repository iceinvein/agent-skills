---
type: regex
pattern: '"status":\s*"done"'
match: 'count:6'
target: { source: file, path: .sluice/run.json }
weight: 3
---
