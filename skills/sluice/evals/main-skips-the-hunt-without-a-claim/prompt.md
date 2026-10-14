---
name: main-skips-the-hunt-without-a-claim
description: The main channel's hunt is conditional. A new interface that nothing calls yet states no limit, boundary, invariant or result to check, so the run says so in one line and does not invoke bug-hunter.
tags: [verify, hunt, main, scaffold, write]
plugins: ["plugins/sluice", "plugins/bug-hunter"]
max_turns: 80
timeout_seconds: 2400
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash, Agent]
expected_outcome: Routes main, adds the Target interface and the empty registry module, never invokes bug-hunter, and says in one line that the intent stated no checkable claim so the hunt was skipped.
---

S3 deploys are coming, and I want the seam in place before that work starts. Add a `Target` interface for deploy targets, with one method per deploy step (`build`, `upload`, `activate`), written as a JSDoc typedef in `src/targets/target.js`, and a `src/targets/index.js` that exports an empty `targets` registry object for the S3 work to add its target to. Nothing calls either of them yet, and `src/cli/deploy.js` is not part of this change.
