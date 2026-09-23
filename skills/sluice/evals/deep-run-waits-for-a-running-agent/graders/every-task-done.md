---
type: regex
pattern: '"status":\s*"done"'
match: 'count:4'
target: { source: file, path: .sluice/run.json }
weight: 2
---
