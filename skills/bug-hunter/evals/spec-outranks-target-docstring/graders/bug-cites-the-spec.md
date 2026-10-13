---
type: llm
# As in proves-a-spec-boundary-bug: the judge cannot run the repro, so "fails
# in the fixture" is judged against the fixture's code, quoted below, and it
# reads the trace because findings.json sits under a slug no file focus names.
focus: trace
weight: 3
---

The agent was asked what QA will find in `src/exports.js`. `SPEC.md` says a
sealed export without a guide stays on offer while its guide is rewritten in
and if that rewrite fails. The module's own docstring says the opposite (a
sealed export without a guide whose rewrite failed is never offered), and the
code follows the docstring:

```js
if (!entry.sealed) return false;
if (!entry.hasGuide && entry.rewrite === "failed") return false;
return true;
```

So `offeredExports([{ id: "a", sealed: true, hasGuide: false, rewrite: "failed" }])`
returns `[]` where the spec requires that export to be offered. Nothing else
in the code departs from the spec.

Find the `findings.json` the agent wrote under `.bug-hunter/` (its content
appears in a Write tool call or a shell command in the trace). If it was
written more than once, judge only the last write, with any later Edit to it
applied.

PASS if its `bugs` array has an entry whose `claim` resolves, through the
`intent` array, to the spec's statement that a sealed export stays on offer
when its rewrite fails (or the spec's broader "offered once it is sealed"
claim, applied to that export), and whose `repro` asserts that a sealed
export with `hasGuide: false` and `rewrite: "failed"` is offered, so that it
fails against the code above.
FAIL if no findings.json content is visible in the trace, if this case
appears only in `ambiguities`, if the bug's claim resolves to the docstring
rather than the spec, or if the repro asserts something the code above
already does.
