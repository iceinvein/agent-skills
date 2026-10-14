---
name: deep-run-hunts-after-the-flip
description: The deep channel's hunt. Every task is done, the flip included, so before the final review the run hunts the whole plan diff against the spec, fixes the off-by-one it proves test-first, and records the hunt in the run record.
tags: [verify, hunt, deep, execution, scaffold, write]
plugins: ["plugins/sluice", "plugins/bug-hunter"]
max_turns: 100
timeout_seconds: 2400
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash, Agent]
expected_outcome: Invokes bug-hunter on the plan's base..HEAD against docs/specs/2026-10-01-step-retries.md before marking the final review with status.sh final; the hunt proves a step runs three times where the spec says four, and the run fixes it with a test, writes a Hunt section into the run record, then runs the final review.
---

Both tasks in the plan have landed, the flip included; it's all in `.sluice/run.json`. Take the run from here to the handback.
