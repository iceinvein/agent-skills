---
name: deep-plan-asks-the-fork
description: The design stop's one exception. A plan whose shape turns on a fact only the partner has (where the shared counters can live) is asked as one question with a recommendation before any design is written, not drafted across both answers.
tags: [routing, deep, design, fork, write]
max_turns: 20
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write]
expected_outcome: Announces the deep channel, asks one question about where the counters can live with a recommendation, writes no design yet and no implementation code.
---

Plan out a shared rate limiter for us. The CLI, the webhook handler and the background worker all hammer the same upstream API and all three need to sit behind one budget, so whatever we build has to be reachable from each of them and hold its counters somewhere they can all see.
