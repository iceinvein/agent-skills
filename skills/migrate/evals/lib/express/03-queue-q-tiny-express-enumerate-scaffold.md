---
id: q-tiny-express-enumerate-scaffold
severity: minor
status: open
---

## Evidence

This run asserts a clean `check --phase enumerate` before extract has run,
and coverage is a whole-store gate: it reads every element regardless of
`--phase`, so an element with no terminal disposition fails it at any
phase. No requirement exists yet at that point for an element to map to.

## Options

(a) Leave every element unaccounted and give up on asserting the enumerate
slice clean at all. (b) Give every element a placeholder out-of-scope
disposition citing this item, which extract then replaces with a real
`mapped` disposition once there is a requirement to map to.

## Recommendation

Recommend (b); it isolates the census and run-state assertions the
enumerate step exists to make from the coverage gate, and citing this item
keeps the placeholder auditable rather than silent. The item stays open
after extract supersedes it, because nothing in this milestone adjudicates
a queue item.
