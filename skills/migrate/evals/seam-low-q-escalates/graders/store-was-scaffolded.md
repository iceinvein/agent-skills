---
type: regex
# The not_contains graders here pass on an empty store, so this one fails if
# the fixture never imported the enumerated ledger.
pattern: '"id":"route-get-api-customers"'
target: { source: file, path: .migrate/elements.jsonl }
weight: 1
---
