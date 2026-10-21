---
type: llm
focus: { source: file, path: docs/plans/OPS-13.md }
weight: 3
---

This is the plan for a signed-off design with three decisions, D1 (the
upstream client retries a 429), D2 (callers log each retry) and D3 (the CLI
takes `--no-retry`), and an Out of scope section that no task should build.

PASS if every task in the plan carries a Builds line (naming the decisions it
builds, or `none` with a reason), and D1, D2 and D3 each appear on the Builds
line of at least one task.
FAIL if any task has no Builds line, or if any of D1, D2 or D3 appears on no
task's Builds line.
