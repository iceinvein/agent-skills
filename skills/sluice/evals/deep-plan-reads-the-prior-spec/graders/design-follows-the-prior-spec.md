---
type: llm
focus: { source: file, path: docs/specs/CNT-7.md }
weight: 3
---

This is the design for a ticket that counts failed sign-ins per account. The
repo already holds `docs/specs/2026-09-01-counters.md`, whose decision says
every counter the service keeps persists in `data/counters.json` and is never
held only in memory, because the process restarts on every deploy. The ticket
never mentions that spec, and since the API, worker and report share one
process, a counter held in memory is the obvious design.

PASS if the design persists the failed sign-in counts through
`data/counters.json`, the file the earlier spec settled (a cache in front of it
is fine), or if it names the conflict with the earlier spec and asks the
partner whether to supersede it.
FAIL if the design keeps the counts in memory (a Map, a module variable, an
in-process object) without naming the conflict with the earlier spec, or puts
them in some other store without saying why the earlier decision no longer
holds.
