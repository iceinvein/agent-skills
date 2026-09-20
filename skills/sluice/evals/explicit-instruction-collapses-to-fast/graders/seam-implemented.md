---
type: llm
focus: { source: file, path: src/cli/deploy.js }
---

This is the deploy module after the change.

PASS if deploy takes its target from outside itself (an argument, an injected object, or a registry lookup) and runs the three steps through it, so a second target could be supplied without editing this function's body.
FAIL if the steps still run against a hardcoded local path with no seam, or if the target is chosen by a conditional inside deploy that a new target would have to be added to.
