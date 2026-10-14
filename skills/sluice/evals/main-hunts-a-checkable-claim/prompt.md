---
name: main-hunts-a-checkable-claim
description: The main channel's hunt. The agreed intent states a checkable claim, so once the code is green bug-hunter runs on the diff, and the bug it proves in an existing helper is fixed test-first.
tags: [verify, hunt, main, scaffold, write]
plugins: ["plugins/sluice", "plugins/bug-hunter"]
max_turns: 80
timeout_seconds: 2400
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash, Agent]
expected_outcome: Routes main, writes pageOf, then invokes bug-hunter on the diff; the hunt proves lastPage drops the remainder page, and the run fixes lastPage to round up with a test asserting the remainder page.
---

Add an exported `pageOf(index, size, total)` to `src/paging.js`: given an item's 0-based index in a list of `total` items, it returns the 1-based page that item lands on. The contract: every page holds `size` items, the last page holds the remainder, an index outside `0` to `total - 1` throws a `RangeError`, and `pageOf` always agrees with `lastPage` in the same file, so the item at index `total - 1` is on `lastPage(total, size)`.
