# Run record: verification gates

Design `docs/specs/2026-10-14-verification-gates.md`, plan
`docs/plans/2026-10-14-verification-gates.md`. Task status lives in
`.sluice/run.json`; this file holds the reasons.

## Pre-flight

- Review: all 6 tasks plus the final review. The hook (T4) and the graders
  (T2, T3) are where a wrong line costs a sluice re-baseline, and T1 edits the
  script every hook reads.
- Effort: T6 at low (a version string and four table rows), T1 to T5 at this
  session's effort.
- Workspace: plan worktree `verification-gates`, cut from local master by
  `git worktree add` because the harness tool branches from origin/master,
  which is 51 commits behind. T1 and T2 can overlap, so each gets a hand-cut
  worktree under `.claude/worktrees/`, merged back as it lands. Agents commit
  their own tasks.

## Decisions

## Findings
- T1 first dispatch: a subagent inherits the controller's worktree lock, so the
  implementer's writes to its hand-cut worktree were refused. It switches with
  EnterWorktree by path (allowed for pinned agents under .claude/worktrees/).
  Worth a line in deep-channel.md's hand-cut worktree rule; noted for T5.
- The pinned-agent EnterWorktree switch was refused as well: a session isolated
  in a worktree caps every dispatched agent's writes to that tree. Per-implementer
  worktrees are impossible from an isolated controller, so the workspace answer
  changed to serial in the plan worktree (partner's choice, recorded with
  preflight --workspace). T1 re-dispatched there.
- T2's agent could not run `claude plugin eval` (its Bash guard refuses the word
  eval) and staged the three cases and the rules.json edit in the scratchpad
  (t2/mirror). The controller runs the probe and lands T2 after T1 commits.

## Decisions (continued)

- Probe 1: a case's `plugins` entry outside the evaluated plugin dir is refused
  ("outside the containment root"), so `../../../bug-hunter` cannot load. The
  installer ships only sluice's references/ and scripts/, so evals/ never
  reaches users. Partner chose a synced copy at
  `skills/sluice/evals/plugins/bug-hunter` (SKILL.md, skill.json, references/),
  held identical to `skills/bug-hunter` by a bun test. T2's Touches grow by
  that dir and the drift test; cases load `["../..", "../plugins/bug-hunter"]`.
- Neither the controller nor the user's `!` input can run `claude plugin eval`
  from this worktree-isolated session (the guard reads it as shell eval), so
  eval runs go through the partner's own terminal.
- Probes 2 to 4: a `plugins` entry may not cover the case dir (so `../..` is
  refused) and must sit inside the case's own directory; a case-local copy of
  bug-hunter loads (`bug-hunter:bug-hunter`, score 1). But `plugins` replaces
  the plugin under test: sluice was absent from that session's skill list.
  Partner chose generated copies of both skills inside each hunt case
  (`<case>/plugins/{sluice,bug-hunter}`, shipped files only), written by a
  sync script and held to `skills/` by a drift test. Probe 5 checks both load.
- Probe 5: case-local `plugins/sluice` and `plugins/bug-hunter` load together
  (`sluice:sluice`, `bug-hunter:bug-hunter`), bug-hunter called, score 1.
- Partner chose to leave the worktree lockdown: the controller exited the
  session's worktree mode with keep and drives the plan branch by path from the
  main checkout, so evals run from here and implementers could again use their
  own worktrees. Plan Tasks 2 and 3 rewritten for the case-local layout; T2 now
  carries `scripts/eval-plugins.ts` and its drift test. T2 re-dispatched.
- T2 review (ab2d63d): Critical, the drift test never saw drift (copyDrift
  stubbed to [] stayed green). Important: the fast grader passed `verify --
  true` with no edits; the lastPage regex failed correct fixes and passed an
  unfloored one; the skip case reused main-new-interface's prompt, whose
  "move the behaviour behind it" is an invariant D3 counts as checkable.
  Decided: suite-only verify plus the --quiet graders; an llm grader on
  src/paging.js; reword the skip prompt to a purely structural interface;
  copies include files.supporting (Task 3 may dispatch the low agent);
  package.json excludes the copies from npm. Left: the `/src/` anchor in
  hunt-after-the-source-edits (a sandbox path containing /src/ would count).
- Found by the T2 reviewer, outside this plan: skills/index.json lists sluice
  0.23.1 while skill.json is 0.23.4 (stale index, already an open release item).
- T2 re-review: Critical and three Important closed (fd748ae). Accepted Minor:
  the skip case is small enough a run may route fast; the table makes a new
  interface main, so expect noise on its first run rather than reshaping it.
- T3 (e0cff54): the flip is already done in the fixture so the case measures
  the hunt, not the implementation; the order grader therefore anchors on
  `status.sh final`, not on the flip's done call. Review: Important, a hunt
  after the final review's dispatch passed (final is marked after the review
  clears); fix adds the Agent dispatch to the lookahead. Minor: a hardcoded 4
  passed the attempts judge. Both sent back.
- T3 fix 1be5195 read: the lookahead now stops at `"name":"Agent"`; a real
  trace (fan-out, e-Z5JY0G) records dispatches as `"name":"Agent"`, not Task.
  T3 closed.
- Plan amended: T6 stopped because the version bump left the case-local sluice
  copies stale (the drift test failed). New Ground Rule: changes to sluice or
  bug-hunter shipped files regenerate the copies in the same commit; T4, T5
  and T6 Touches carry the three plugins/sluice/ dirs. The planner (me) missed
  that the copies make every later sluice edit touch them.
- T6 review: Important, the README's "Fourteen cases scaffold" was stale
  (eighteen); fixed in 149669c with two wording Minors. T6 closed.
- T4 (flip): two existing stop-guard tests (d7, d8) expected silence for a fast
  route on a moved, unverified tree, which D2 now refuses. Partner approved
  changing only their fixtures' route to deep (assertions unchanged), since
  they test the entry check reading the route call, not the channel.
- Flip review (e8f40b8): no Critical; two Important with one root. The
  tree-snapshot digest missed edits to new files made after verify, and read a
  commit after verify as a change. Partner chose a content digest
  (`git write-tree` over a temp index after `git add -A`) for verify and the
  gate; D1 and D2 amended in the spec; tree-snapshot.sh stays for the entry
  check. Sent back to the flip's implementer with status.sh in its fix Touches.
  Minor left: a nudged session now pays a snapshot per stop.
- Flip re-review (f6006a3): both Important closed, earlier scenarios hold.
  Cost about 0.045s per moved fast/main stop on this repo. Minors: the
  digest header wrongly lists a held lock as unknown, and verify swallowed
  git's error (both sent back). For T5 to document in verify.md: one
  unreadable untracked file makes the digest unknown, which switches the gate
  off for the session; each digest writes loose blobs for changed content
  (gc removes them; split-index leaves sharedindex files); nested repos are
  invisible, as for tree-snapshot.sh.
- Flip closed at 630b896 (verify now prints git's error; the digest header no
  longer lists a held lock as unknown).
- T5 (1c13b4c): references written. The implementer found the spec's D1 said
  run-stats reads the --none reason; it has no code for that. Spec corrected
  (the reason lands in the transcript for the partner; run-stats reporting gate
  status was already out of scope). Deep fixes go to an implementer like any
  task, per the existing rule that findings are not the controller's to fix.
- T5 review: three Important (the worktree-mode cap contradicted the isolate
  bullet; whether a deep hunt fix takes a row was ambiguous, decided: the hunt
  takes none, each fix does, reviewed at its tier; a test satisfied by --none)
  and five Minor wording truths. Sent back.
