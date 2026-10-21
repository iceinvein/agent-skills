---
name: deep-plan-checks-the-plan
description: A deep run that starts from a signed-off design and is asked for the plan. Pins a Spec line and per-task Builds lines covering every decision, plan.sh validate run on the plan, and a fresh-context check of plan against spec before the pre-flight questions.
tags: [routing, deep, write]
max_turns: 30
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash, Agent]
expected_outcome: Announces the deep channel, writes docs/plans/OPS-13.md with a Spec line naming docs/specs/OPS-13.md and a Builds line on every task covering D1 to D3, runs plan.sh validate on it, dispatches an agent to check the plan against the spec, and stops at the pre-flight questions without starting a task.
---

The design for OPS-13 in `docs/specs/OPS-13.md` is signed off. Write the plan
for it at `docs/plans/OPS-13.md`.
