# Design: sluice eval follow-up (Opus 5.5)

## Context

The Opus 5.5 run (branch `worktree-sluice-opus-5-5`, closed 12/12) left four
things open, which you asked to take next:

1. The Stop hook refused every turn end while an implementer or reviewer was
   running in the background. Each wait in that run needed `status.sh pause`.
   The Opus 5.5 prompting doc names that as a stop to take ("wait for it to
   finish").
2. `deep-run-blocks-on-a-real-decision` has a second contract break its
   graders do not know about: Task 3 makes `sink` a required second parameter
   of the published `deploy`. All six deep fixtures also carry a Task 2 step
   ("the existing dry-run test still passes") that the 5.5 runs flagged as
   contradicting the existing test once `quiet` joins the return value.
3. The handback judges in finishes-every-task, survives-a-milestone and
   waits-for-a-running-agent fail a message that "asks whether to proceed", and
   every 5.5 run ended on the merge / PR / leave choice that
   `references/finish.md` requires. The waits judge (`focus: trace`) was shown
   a trace with every dispatch elided.
4. No clean 5.5 execution baseline. Homebrew git now runs inside the eval
   sandbox when called by path (bare `git` still resolves the shim; reported).

Work continues on the same branch and worktree. The Opus 5.5 run was closed
("branch left as it stands") so this one can open.

## Decisions

### D1. A turn may end while a dispatch is in flight

`stop-guard.sh` lets the stop through when any task is `active` or `review`.
deep-channel.md already defines `active` as "at dispatch" and `review` as "its
reviewer has gone out", so either status means something is running that the
harness will report back on. The guard keeps refusing the stop it exists for:
tasks still `todo`, nothing in flight, nothing blocked or paused ("T4 goes
next").

- deep-channel.md: waiting on a dispatched agent joins the wanted stops, with
  the condition spelled out (the row is flipped `active` at the dispatch, not
  before), and the pause-while-waiting advice goes.
- Trade-off: a controller-run task marked `active` that then stops mid-task is
  let through. Accepted: the hook is a nudge, controller-run tasks are the
  exception, and the alternative (reading the transcript for unreturned async
  agents) couples the hook to harness message text that changed twice in the
  CLI versions this repo has seen.
- The refusal reason loses its duplicated blocked sentence (final-review nit 8),
  keeping the one that names the command.

### D2. Fix the fixtures, not the graders

- `deep-run-blocks-on-a-real-decision`: Task 3's Contract gives `sink` a
  default that prints (`deploy(args, sink = createSink({ quiet: false }))`), so
  the published `deploy(args)` keeps working and Task 4 is the only collision.
- All six deep fixtures: Task 2's steps say the existing dry-run test is
  updated to expect `quiet: false` once the key exists, instead of claiming it
  still passes.
- Each fixture's `.sluice/run.json` is regenerated with `status.sh init`,
  `plan.sh import` and `status.sh preflight`, never edited by hand, and each
  plan passes `plan.sh validate`.

### D3. Handback judges accept the finish question

The three handback graders gain one sentence: ending with the partner's
finish choice (merge, open a PR, or leave the branch) is part of a handback,
not a check-in. The waits grader moves to `focus: last_message`, and its order
claim ("after the last result") is carried by the existing `every-task-done`
file grader plus the final message not saying an agent is still running.

### D4. Re-run the deep cases

`deep-run-*` with Homebrew git in place, `--runs 1 --ablation none
--keep-temp --model claude-opus-5-5`, capped at USD 15 (about USD 83 of the
100 remains). Each trace is checked for bare-`git` shim failures, and a score
is only recorded as clean where the run could commit. The README's 5.5 section
is updated with what the rerun shows.

### Not in this run

Widening the route marker (a Ground Rule change), the unanchored escalation
grader, the agent file's extra reply line, and `route` needing jq. Say if you
want any of them folded in.

