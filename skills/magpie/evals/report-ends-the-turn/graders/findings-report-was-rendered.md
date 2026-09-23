---
type: regex
pattern: 'magpie render \S+ findings'
target: { source: file, path: .magpie-calls.log }
weight: 2
---
