---
type: regex
# The fixture's re-import cleared the signature. Red if the scaffold failed, or
# if the run signed the delta on the owner's behalf.
pattern: '"id":"delta-mailer-provider-swap"[^\n]*"owner_signed":null'
target: { source: file, path: .migrate/deltas.jsonl }
---
