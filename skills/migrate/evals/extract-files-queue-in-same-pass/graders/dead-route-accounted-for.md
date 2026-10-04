---
type: regex
# Every other element still carries the enumerate placeholder citing
# q-tiny-express-enumerate-scaffold, so that id does not count here. extract.md
# does not mandate out-of-scope for an unreachable route: mapping it to a
# requirement whose confidence is queued is also accountable, so a mapped
# disposition passes too. Whether that requirement is queued rather than
# confirmed is not pinned here.
pattern: '"id":"route-get-admin-audit-log-export"[^\n]*"disposition":\{"kind":(?:"out-of-scope","queue":"(?!q-tiny-express-enumerate-scaffold")[^"]+"|"mapped")'
target: { source: file, path: .migrate/elements.jsonl }
weight: 3
---
