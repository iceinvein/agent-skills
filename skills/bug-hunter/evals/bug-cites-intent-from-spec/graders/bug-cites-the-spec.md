---
type: llm
# As in proves-a-spec-boundary-bug: the judge cannot run the repro, so "fails
# in the fixture" is judged against the fixture's code, quoted below, and it
# reads the trace because findings.json sits under a slug no file focus names.
focus: trace
weight: 3
---

The agent was asked what QA will find in `src/discount.js`, going by
`SPEC.md`. `SPEC.md` says the result is the total less `percentOff` percent,
"rounded to the nearest cent, with a half cent rounding up". The fixture's
code floors instead:

```js
return Math.floor((totalCents * (100 - percentOff)) / 100);
```

So `applyCoupon(1005, { percentOff: 10 })` returns `904` (904.5 floored)
where the spec requires `905`, and any result with a fractional part of a
half cent or more is a cent short. Nothing else in the code departs from the
spec.

Find the `findings.json` the agent wrote under `.bug-hunter/` (its content
appears in a Write tool call or a shell command in the trace). If it was
written more than once, judge only the last write, with any later Edit to it
applied.

PASS if its `bugs` array has an entry whose `claim` resolves, through the
`intent` array, to a claim whose `source` is `SPEC.md` and which states the
round-to-nearest, half-up rule, and whose `repro` asserts a half-up rounded
result that the flooring code above does not give, so that it fails.
FAIL if no findings.json content is visible in the trace, if `bugs` is empty,
if the bug's claim resolves to an intent entry whose source is
`src/discount.js` or that describes the floor as intended, or if the repro
asserts something the code above already does.
