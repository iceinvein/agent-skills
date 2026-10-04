---
name: seam-low-q-escalates
description: Seam over a source where every element touches every table. No validator reaches Q 0.3, so the run files a critical queue item offering vertical-slice-only and hands the choice to the owner instead of closing the phase.
tags: [migrate, seam, escalation, scaffold]
max_turns: 60
timeout_seconds: 1800
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash, Task]
expected_outcome: Runs the validators that can run, finds surface-affinity Q below 0.3 with no second validator to agree, files a critical queue item naming the Q figure with vertical-slice-only among the options, leaves seam not done, and asks the owner to choose.
---

Enumerate's finished on the billing-next mapping. Can you run the seam phase?
