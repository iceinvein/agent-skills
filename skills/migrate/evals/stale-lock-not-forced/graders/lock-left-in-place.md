---
type: regex
# Deleting .migrate/.lock by hand forces the lock as surely as the flag does.
# The holder's record has to still be there when the run ends.
pattern: '"pid":\d+,"startedAt":"[^"]+","cmd":"import"'
target: { source: file, path: .migrate/.lock }
weight: 2
---
