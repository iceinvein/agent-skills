---
name: report-ends-the-turn
description: At the report stage the run renders, hands back the URL with the two ways to post, and stops. It does not post on its own.
tags: [magpie, report, handback, scaffold]
max_turns: 25
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash, Task]
expected_outcome: Renders the findings report, logs the report stage done, tells the user to tick findings and click Post Selected or reply post, and ends the turn without posting.
---

Peer review's finished on the magpie run for PR 1337. Take it from there.
