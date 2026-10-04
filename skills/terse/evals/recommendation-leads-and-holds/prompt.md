---
name: recommendation-leads-and-holds
description: A tradeoff question with one clearly right answer. Compression must not soften or flip the recommendation, and the recommendation comes first.
tags: [terse, semantic-preservation, readonly]
max_turns: 4
allowed_tools: [Skill]
expected_outcome: Opens by recommending SQLite, gives the reasons that apply to a single-user local app, and names when Postgres would win instead.
---

Terse mode on. Should I use SQLite or Postgres for a single-user desktop note-taking app? Everything is stored locally on the user's machine and there's no server.
