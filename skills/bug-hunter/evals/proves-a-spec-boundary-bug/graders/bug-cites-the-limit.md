---
type: llm
# A grader cannot run a command, so "the repro fails in the fixture" is judged
# against the fixture's code, which is fixed and quoted below: a repro that
# asserts a 20-character name is accepted fails against it, and one that
# asserts anything the code already does passes. The judge reads the trace
# because findings.json sits under a slug no file focus can name, and the
# judge sees only a head-and-tail window of a long trace.
focus: trace
weight: 3
---

The agent was asked what QA will find in `src/username.js`. `SPEC.md` says a
username is 3 to 20 characters long, inclusive. The fixture's code rejects a
name when `name.length < 3 || name.length >= 20`, so a name of exactly 20
characters is wrongly rejected. Nothing else in the code departs from the
spec.

Find the `findings.json` the agent wrote under `.bug-hunter/` (its content
appears in a Write tool call or a shell command in the trace).

PASS if its `bugs` array has an entry whose `claim` is the intent claim for
the 3 to 20 inclusive length limit (the claim id must resolve, through the
`intent` array, to that limit), and whose `repro` asserts that a username of
exactly 20 characters is accepted, so that it fails when run against the code
above.
FAIL if no findings.json content is visible in the trace, if `bugs` is empty,
if the only bug cites some other claim, or if the repro asserts something the
code above already does (so it would pass, not fail).
