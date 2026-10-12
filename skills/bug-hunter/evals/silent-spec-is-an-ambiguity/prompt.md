---
name: silent-spec-is-an-ambiguity
description: A limit whose value the spec never states has no expected value to prove a bug against. Pins the finding landing in ambiguities, with bugs left empty.
tags: [ambiguity, boundary, scaffold, write]
max_turns: 80
timeout_seconds: 2400
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash, Agent]
expected_outcome: findings.json under .bug-hunter/ has an empty bugs array and an ambiguity asking what the quantity cap is.
---

Before this goes to QA: what will they find in `src/cart.js`? It's meant to do what `SPEC.md` says.
