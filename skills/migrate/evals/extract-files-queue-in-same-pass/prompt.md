---
name: extract-files-queue-in-same-pass
description: Extract over audit-retention, which holds a route nothing reaches. The route is disposed out-of-scope citing a queue item, and that item is filed before any check can see its id dangling.
tags: [migrate, extract, queue, scaffold]
max_turns: 60
timeout_seconds: 1800
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash, Task]
expected_outcome: Mines audit-retention, disposes route-get-admin-audit-log-export out-of-scope citing a new queue item, and files that item with migrate queue add in the same pass, so no migrate check reports the queue id as missing.
---

Seam's done on the tiny-next mapping. Run extract for the audit-retention capability.
