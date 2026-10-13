---
name: bug-cites-intent-from-spec
description: The skill may read the code, but a claim never comes from what a changed body does. Pins the rounding bug citing an intent claim sourced from SPEC.md, with a repro expecting half-up rounding.
tags: [intent, arithmetic, scaffold, write]
max_turns: 80
timeout_seconds: 2400
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash, Agent]
expected_outcome: intent.md exists, and findings.json under .bug-hunter/ has a bug whose claim resolves to SPEC.md's half-cent-rounds-up rule, with a repro that fails against the flooring code.
---

What will QA find in `src/discount.js`, going by `SPEC.md`?
