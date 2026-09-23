---
type: regex
pattern: '"status":\s*"blocked"'
match: 'count:0'
target: { source: file, path: .sluice/run.json }
weight: 3
---
