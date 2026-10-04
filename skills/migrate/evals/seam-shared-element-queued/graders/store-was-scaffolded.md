---
type: regex
# shared-setting-in-no-capability passes on an empty store, so this one fails
# if the fixture never imported the enumerated ledger.
pattern: '"id":"setting-default-connection"'
target: { source: file, path: .migrate/elements.jsonl }
weight: 1
---
