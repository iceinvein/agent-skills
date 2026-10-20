---
name: false-success-is-a-bug
description: A close that answers ok after a rename but leaves the workspace in place. The spec never mentions renaming and then closing, so the case reads like a product question, but a reported success that did not do the work is wrong under every answer. Pins a bug rather than an ambiguity.
tags: [bug, baseline, scaffold, write]
max_turns: 80
timeout_seconds: 2400
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash, Agent]
expected_outcome: "findings.json under .bug-hunter/ has a bug for closing a renamed project, which returns { ok: true } and leaves its workspace, with a repro that fails against the fixture."
---

Before this goes to QA: what will they find in `src/workspaces.js`? It's meant to do what `SPEC.md` says.
