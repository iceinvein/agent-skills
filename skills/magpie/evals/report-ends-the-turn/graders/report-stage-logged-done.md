---
type: regex
pattern: '"stage":\s*"report"[^\n]*"done"|"done"[^\n]*"stage":\s*"report"'
target: { source: file, path: runs/pr-1337-1789600000/log.jsonl }
weight: 2
---
