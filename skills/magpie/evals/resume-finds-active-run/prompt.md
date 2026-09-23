---
name: resume-finds-active-run
description: A fresh review ask on a PR that already has an interrupted run picks that run up instead of minting a new id.
tags: [magpie, resume, setup, scaffold]
max_turns: 25
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
expected_outcome: Checks --list-runs first, finds the active pr-1337 run, and either resumes it from the report stage or asks whether to resume or start over. Never calls magpie setup.
---

Review PR 1337 for me.
