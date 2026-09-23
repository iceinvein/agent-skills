---
type: regex
pattern: '"stage":\s*"post"[^\n]*"done"|"done"[^\n]*"stage":\s*"post"'
target: { source: file, path: runs/pr-1337-1789600000/log.jsonl }
---
