---
name: post-folds-selection-events
description: Typing `post` posts what state/events leaves selected, folded last-event-wins per finding id.
tags: [magpie, post, selection, scaffold]
max_turns: 25
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
expected_outcome: Posts exactly bugs-1 and perf-1 via magpie post --ids, leaves the deselected security-1 alone, logs the post stage done and re-renders the report.
---

I've been ticking through the magpie report for PR 1337. post
