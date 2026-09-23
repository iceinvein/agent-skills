# Run record: sluice-eval-followup

## Pre-flight

- Review: tier 3 only. Task 2 (the flip) and Task 5 (the eval numbers) get a
  reviewer; the other four get a commit-stat check. Partner's pick.
- Effort: every task on the session's effort. Only one live answer: no task
  carries an `Effort` mark.
- Workspace: the existing `worktree-sluice-opus-5-5` worktree, one implementer
  at a time. Only one live answer: the harness cuts new worktrees from
  origin/master, which lacks this branch.
- Eval spend: at most USD 15 across this plan.
- The previous run (sluice-opus-5-5) was closed as "branch left as it stands"
  so this one could open; its merge or PR choice is still the partner's.

## Log
- Task 1 (c12fb13): the in-flight rule replaced the existing test "a run with
  an active task still in flight is blocked too", which pinned the behaviour
  D1 reverses, and dropped one line from "names every open task" that set a
  task active only to reach a refusal. Also seen: sluice-status "cells narrow
  as the task count grows" hit bun's 5s timeout, alone and in the full run;
  untouched by this plan, passes with a longer timeout. Watched, not changed.
- The session's own Stop hook runs the installed copy under ~/.claude/skills,
  not this worktree's, so this run still pauses while agents are out.
- Task 2 review (round 1, with Task 1): nothing blocking. Fix round takes:
  the row-exit sentence (flip to review/done/todo in the message that reads
  the agent's report; reset an `active` row with no agent behind it on
  resume), status.md and the stop-guard header comment brought in line with
  the in-flight rule, the ambiguous "mid-run request for a dispatch is a
  pause" reworded, SKILL.md's clause matched to what the hook checks, the
  dead active/review selection in the open list dropped, long lines rewrapped.
  Touches widen to status.md and stop-guard.sh for this round. Waits for T3
  to commit first.
- Eval pass 2 (deep-run-*, USD 10.55 of this plan's 15; about USD 27.75 of the
  100 overall): blocks, finishes, survives, fans-out 1.00; decides 0.73; waits
  0.63. No trace carries the Stop hook refusal.
- Task 5 review: one blocking finding, corrected in the README. The Command
  Line Tools binary runs in the sandbox by full path; only listing its
  directory is refused. Two pass-2 runs used it rather than Homebrew's, and
  the earlier "no git" readings were partly the listing refusal misread. The
  Homebrew install was not what made pass 2 work. Also corrected: the waits
  reading (Still open section, not the npm line alone), decides' missing
  finish-choice sentence, the fans-out duration as a weak baseline, and three
  wording nits.
- Final review: nothing blocking. Fixed: the blocks case's expected_outcome
  named a "public-API test" that does not exist; it now names `API.md`, which
  is what `contract-not-rewritten` checks. Left as nits: Task 3's Contract
  could state that the default sink keeps the published stdout behaviour; the
  plan's Task 3 Offers says `quiet: false` where three fixtures use their own
  key; one long commit subject; one long comment line in stop-guard.sh.
