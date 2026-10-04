---
name: seam-shared-element-queued
description: Seam over tiny-webforms. DefaultConnection is read by code serving three of the four capabilities, so it goes to the queue and into no capability rather than being parked in one.
tags: [migrate, seam, edgeless, scaffold]
max_turns: 60
timeout_seconds: 1800
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash, Task]
expected_outcome: Writes capabilities.jsonl with every element but setting-default-connection in exactly one capability, files a queue item naming setting-default-connection, and leaves it out of the partition.
---

Enumerate is done on the webforms-next mapping. Please run the seam phase next.
