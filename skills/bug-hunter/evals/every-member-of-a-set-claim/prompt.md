---
name: every-member-of-a-set-claim
description: A claim that every dropped cited source is logged, held at two of three drop sites. The existing tests cover each reason on the cited-only path; the cap cut after attachments are merged in logs nothing. Pins the hunt checking the claim at every site that drops a source, not only the ones the tests reach.
tags: [bug, coverage, scaffold, write]
max_turns: 80
timeout_seconds: 2400
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash, Agent]
expected_outcome: findings.json under .bug-hunter/ has a bug for a cited source cut by the five-slot cap when attachments fill slots, returned nowhere and logged nowhere, with a repro that fails against the fixture.
---

Before this goes to QA: what will they find in `src/sources.js`? It's meant to do what `SPEC.md` says.
