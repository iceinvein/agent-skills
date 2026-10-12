---
name: correct-code-has-no-bugs
description: A module that already meets its spec at every stated limit. Pins the skill reporting no bugs rather than turning a passing hunt into a finding.
tags: [false-positive, boundary, scaffold, write]
max_turns: 80
timeout_seconds: 2400
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash, Agent]
expected_outcome: findings.json under .bug-hunter/ has an empty bugs array; the boundary scenarios land in covered.
---

What will QA find in `src/paginate.js`? It should do exactly what `SPEC.md` describes.
