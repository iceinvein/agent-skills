---
type: regex
pattern: 'magpie post[\s\S]*magpie render \S+ findings'
target: { source: file, path: .magpie-calls.log }
---
