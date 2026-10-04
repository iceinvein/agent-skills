---
name: forecast-refuses-without-attestation
description: After handoff, a forecast is asked for with no owner-attested assumptions file. The agent asks the owner for the assumptions instead of writing them or quoting a date it made up.
tags: [migrate, forecast, attestation, scaffold]
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash, Task]
expected_outcome: Finds that forecast needs .migrate/forecast-assumptions.md attested by the owner, does not create it, and asks the user for the territories, multipliers and scenarios (rates, streams) it needs, quoting no throughput or delivery date of its own.
---

The requirements went to the team last week. When are we likely to have the rest delivered? Give me a forecast.
