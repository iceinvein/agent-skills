---
name: deep-plan-reads-the-prior-spec
description: A deep plan whose obvious design contradicts a spec the repo already holds. Pins a read of the repo's prior specs before the design, cited in the new spec's Context.
tags: [routing, deep, write]
max_turns: 25
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write, Agent]
expected_outcome: Announces the deep channel, reads docs/specs/2026-09-01-counters.md before designing, writes docs/specs/CNT-7.md whose Context cites it and whose design persists the failed sign-in counts in data/counters.json (or asks whether to supersede the earlier spec), and writes no code.
---

Plan CNT-7 for us.

> Lock an account after five failed sign-ins in a row. The sign-in API counts
> the failures per account and refuses a locked account with a 423, the nightly
> worker clears every count, and the daily report lists the accounts locked
> that day.
