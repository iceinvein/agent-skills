---
name: proves-a-spec-boundary-bug
description: An off-by-one at a limit the spec states is the bug the skill exists to prove. Pins a confirmed bug in findings.json that cites the limit and carries a repro that fails against the fixture.
tags: [bug, boundary, scaffold, write]
max_turns: 80
timeout_seconds: 2400
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash, Agent]
expected_outcome: findings.json under .bug-hunter/ has one bug citing the 3 to 20 inclusive claim, with a repro asserting a 20-character name is accepted.
---

QA starts on signup tomorrow. What are they going to find in `src/username.js`? `SPEC.md` is what it's meant to do.
