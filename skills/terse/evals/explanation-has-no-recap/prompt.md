---
name: explanation-has-no-recap
description: A conceptual explanation lands without a preamble, without restating the question, and without a closing summary of what it just said.
tags: [terse, filler, readonly]
max_turns: 4
allowed_tools: [Skill]
expected_outcome: Explains that the default list is created once at definition time and shared across calls, and gives the None-sentinel fix. No opener, no recap.
---

Terse mode. Why does `def add(item, items=[])` in Python keep growing the list across calls?
