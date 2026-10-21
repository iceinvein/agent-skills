---
type: regex
pattern: '(^|\n)magpie setup \S+ (\S+ )*--local'
target: { source: file, path: .magpie-calls.log }
weight: 3
---
