---
type: regex
pattern: '"status":\s*"blocked"'
match: 'count:1'
target: { source: file, path: .sluice/run.json }
weight: 3
---
