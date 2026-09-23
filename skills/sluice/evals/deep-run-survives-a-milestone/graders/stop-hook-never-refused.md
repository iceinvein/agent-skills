---
type: regex
# The refusal names the topic, which the hook's own source does not, so a run
# that reads stop-guard.sh does not trip this.
pattern: 'sluice: the deep run step-timings is'
match: 'count:0'
target: trace
weight: 2
---
