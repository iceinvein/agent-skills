---
name: deep-plan-across-subsystems
description: A plan asked for across three subsystems is the deep channel. Pins the announcement, the written design, and stopping before code.
tags: [routing, deep, write]
max_turns: 20
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write]
expected_outcome: Announces the deep channel, writes a design under docs/specs/, stops for sign-off, and writes no implementation code.
---

Plan out a shared rate limiter for us. The CLI, the webhook handler and the background worker all hammer the same upstream API and all three need to sit behind one budget, so whatever we build has to be reachable from each of them and hold its counters somewhere they can all see.
