---
type: regex
pattern: '"stage":\s*"context"[^\n]*"(done|skipped)"|"(done|skipped)"[^\n]*"stage":\s*"context"'
target: { source: file, path: runs/pr-1337-1789600000/log.jsonl }
weight: 2
---
