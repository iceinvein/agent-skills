---
name: deep-run-decides-a-non-blocking-choice
description: A plan task that leaves a choice open and says either answer is fine is decided by the controller and written down, not handed back as a question.
tags: [routing, deep, execution, scaffold, write]
max_turns: 80
timeout_seconds: 2400
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
expected_outcome: The controller picks `->` or `>>`, records which in the run record, and carries all three tasks to done with nothing blocked; the turn ends at the handback.
---

Plan's signed off and pre-flight's answered, it's all in `.sluice/run.json`. Go.
