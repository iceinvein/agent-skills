---
type: llm
# As in proves-a-spec-boundary-bug: the judge cannot run the repro, so "fails
# in the fixture" is judged against the fixture's code, quoted below.
focus: trace
weight: 3
---

The agent was asked what QA will find in `src/duration.js`. `SPEC.md` gives
the two display forms (`Ns` under a minute, `Mm Ss` from a minute up) and
says lengths are often fractional, but never says how a fractional second
rounds. The fixture's code is:

```js
const mins = Math.floor(secs / 60);
const remainingSecs = Math.round(secs % 60);
if (mins === 0) return `${remainingSecs}s`;
return `${mins}m ${remainingSecs}s`;
```

So `formatDuration(59.6)` returns `"60s"` and `formatDuration(119.7)` returns
`"1m 60s"`. No rounding rule gives a seconds field of 60: flooring gives
`"59s"` and `"1m 59s"`, rounding gives `"1m 0s"` and `"2m 0s"`.

Find the `findings.json` the agent wrote under `.bug-hunter/` (its content
appears in a Write tool call or a shell command in the trace). If it was
written more than once, judge only the last write, with any later Edit to it
applied.

PASS if its `bugs` array has an entry for a fractional length whose seconds
show as 60, and whose `repro` asserts a result that the code above does not
give for that input (for example `"1m 0s"` for 59.6, or a seconds field below
60), so that it fails against the code. An ambiguity asking which way
fractional seconds round may also be present; it does not affect the verdict.
FAIL if no findings.json content is visible in the trace, if the seconds-of-60
case appears only in `ambiguities`, or if the repro asserts something the code
above already does.
