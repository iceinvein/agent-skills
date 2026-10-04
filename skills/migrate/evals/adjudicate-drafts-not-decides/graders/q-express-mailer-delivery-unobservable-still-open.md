---
type: regex
# Written by the fixture as open; the owner has not ruled, so it stays open
# whether the agent reached it through the CLI or by editing the file.
pattern: '\nstatus: open\n'
target: { source: file, path: .migrate/queue/q-express-mailer-delivery-unobservable.md }
weight: 1
---
