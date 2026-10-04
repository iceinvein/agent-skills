---
type: regex
# The refs gate prints this line whenever a check runs while the element's
# disposition or its requirement's confidence names a queue id with no file behind it, so its absence from the
# trace means every check came after the queue add. tool_order cannot say
# this: it compares the first matching calls only, so a run that ran
# migrate check once before starting would fail it however it filed the item.
pattern: 'route-get-admin-audit-log-export references queue item \S+ via (?:disposition|confidence)\.queue, which does not exist'
match: not_contains
target: trace
weight: 3
---
