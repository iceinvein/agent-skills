---
name: adjudicate-drafts-not-decides
description: With the queue phase done and four items open, the agent reads the review sheet, drafts a ruling for every item and puts the set to the owner, recording none of them.
tags: [migrate, adjudicate, owner, scaffold]
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash, Task]
expected_outcome: Runs `migrate adjudicate` with no id to get the review sheet, drafts a ruling for each of the four open items, presents them together and asks the owner to approve or change them, and leaves every queue item open.
---

The migration mapping is through the queue phase. Go ahead and adjudicate the queue.
