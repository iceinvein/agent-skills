---
name: done-means-plain-check
description: Every phase reads done, but one sanctioned delta has lost its owner signature. Asked whether the mapping is finished, the run answers from plain migrate check and says no, naming the unsigned delta.
tags: [migrate, check, completion, scaffold]
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash, Task]
expected_outcome: Runs migrate check with no --phase, sees the deltas violation, and answers that the mapping is not finished because delta-mailer-provider-swap is not owner-signed.
---

Is the mapping for ./legacy finished?
