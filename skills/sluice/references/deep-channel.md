# Deep channel

## Plan format

- A plan opens with **Goal**, **Architecture**, and **Global Constraints**:
  exact-value, project-wide requirements every task inherits.
- Each task states exact paths: what it creates, modifies, and tests.
- Each task carries an **Interfaces** block, **Consumes** and **Produces**,
  with exact signatures: the implementer never reads another task, so this
  is its only source for their names and types. Not optional.
- A task may carry a **Review** field naming why it needs the stronger tier
  (auth, data, money, concurrency); otherwise the table below decides.
- Steps are checkboxes: an action, and the proof it worked. Skip the
  test-first ritual per step; `references/test-first.md` owns it.
- Include code only where exact text matters: signatures, magic strings,
  test cases, commands. Specify prose deliverables by their claims and
  budget, not by reproducing them.
- Every step needs real content of its own: no TBD, no pointing at another
  task instead of writing it out, no name for a type or function no task
  defines.

```
# Plan: <topic>
## Global Constraints
- <exact value>
### Task N: <name>
**Interfaces:** Consumes: <sig> | Produces: <sig>
**Touches:** <path> (new) | <path> (edit) | <path> (test)
**Review:** <reason, or omit>
- [ ] <action> -> <proof>
```

## Dispatch rules

- One `TaskCreate` per task, marked in progress then complete. That state
  outlives compaction; your memory doesn't.
- Dispatch a fresh agent per task with the task text, never your session
  history.
- **Never run two implementers at once.** They collide in the same files.
- Fan out for work that doesn't write: investigations or searches, one
  agent per question, dispatched in one message so they run concurrently.
  The test: could two agents touch the same file?
- Isolate the workspace before a multi-task plan: use the harness's
  worktree tool, not `git worktree`; never start on main without your
  partner's OK.
- Match the model to the task: cheap for mechanical work, stronger for
  judgment and final review.

## Review policy

A review costs about what the implementation cost, so reviewing every task
doubles the plan. Checking that Produces landed and only declared Files
changed is free, a `git diff --stat` read; only quality judgment needs a
dispatch.

| Task shape | Review |
|------------|--------|
| Only touched files it created, tests pass, matches its Interfaces block | No dispatch. Read the diff stat yourself. |
| Modified existing code, or later tasks build on it | One reviewer dispatch |
| Auth, data, money, concurrency, or the plan flags it | One reviewer dispatch, stronger model |
| No executable test covers it: prose, config, docs | One reviewer dispatch; a diff stat can't confirm the words are right |

Hand the reviewer a file: `git diff <base> <head> > <file>`. Base is the
commit the task actually started from: step back one commit from HEAD
and a five-commit task collapses to its last commit alone. Findings
return to its author.

**Verify small fixes yourself:** read the diff and confirm the named test
ran; re-review only for substantial logic changes. Cap this at three
rounds; one still open after that is structural: stop and report it.

**A finding surviving two rounds may be a defect in the criterion, not the
work.** Before a third round, ask whether any output could satisfy it. A
criterion that rejects every attempt the same way never converges, and the
work degrades each round as it contorts toward an unpassable test. Fixing
the criterion is your partner's call.

Never fix findings yourself while coordinating: it skips review and burns
context the remaining tasks need. Two buckets only: fix it now, or record
it in the task's `TaskCreate` entry for the final review. A reviewer may
describe severity in words; a third disposition or formal adjudication
step is banned.

The final review covers cross-task integration and anything deferred, not
lines a per-task review cleared.
