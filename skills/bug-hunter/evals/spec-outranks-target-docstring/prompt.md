---
name: spec-outranks-target-docstring
description: The spec and a docstring inside the changed code disagree, and the code follows the docstring. Pins a confirmed bug citing the spec claim, not an ambiguity between the two.
tags: [bug, precedence, scaffold, write]
max_turns: 80
timeout_seconds: 2400
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash, Agent]
expected_outcome: findings.json under .bug-hunter/ has a bug citing the spec's claim that a sealed export stays on offer when its rewrite fails, with a repro that fails against the fixture.
---

We're shipping the download list on Thursday. What will QA find in `src/exports.js`? `SPEC.md` is what it's meant to do.
