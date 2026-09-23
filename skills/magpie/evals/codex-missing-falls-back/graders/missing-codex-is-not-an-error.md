---
type: regex
pattern: '"status":\s*"error"'
match: not_contains
target: { source: file, path: runs/pr-1337-1789600000/log.jsonl }
weight: 2
---
