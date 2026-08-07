# Deep channel

## Plan format

- A plan opens with **Goal**, **Architecture**, and **Global Constraints**:
  exact-value, project-wide requirements every task inherits.
- Each task states exact paths: what it creates, modifies, and tests.
- Each task carries an **Interfaces** block, **Consumes** and **Produces**,
  with exact signatures. The implementer sees only its task, so this is
  how it learns its neighbours' names and types. Not optional.
- Steps are checkboxes: an action, and the proof it worked. Skip the
  test-first ritual per step; `references/test-first.md` owns it.
- Include code only where exact text matters: signatures, magic strings,
  test cases, commands. Specify prose deliverables by their claims and
  budget, not by reproducing them.
- No placeholders: no TBD, no "similar to Task N", no reference to an
  undefined type or function. Each is a plan failure.

```
# Plan: <topic>
## Global Constraints
- <exact value>
### Task N: <name>
**Files:** Create: <path>
**Interfaces:** Consumes: <sig> | Produces: <sig>
- [ ] Step 1: <action>. Result: <proof>.
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
  worktree tool over `git worktree`, and never start on main without your
  partner's OK.
- Match the model to the task: cheap for mechanical work, stronger for
  design judgment and final review.

## Review policy

A review costs about what the implementation cost, so reviewing every task
doubles the plan. Checking that Produces landed and only declared Files
changed is free, a `git diff --stat` read, not a dispatch; only quality
judgment needs one.

| Task shape | Review |
|------------|--------|
| Only touched files it created, tests pass, matches its Interfaces block | No dispatch. Read the diff stat yourself. |
| Modified existing code, or later tasks build on it | One reviewer dispatch |
| Auth, data, money, concurrency, or the plan flags it | One reviewer dispatch, stronger model |

Hand the reviewer a file: `git diff <base> <head> > <file>`. Base is the
task's starting commit, never `HEAD~1`, which captures only the last
commit and silently omits most of a multi-commit task's diff. Findings
return to its author.

**Verify small fixes yourself:** read the diff and confirm the named test
ran. Re-review only for substantial logic changes; most fixes are too
small to earn one. Cap this at three rounds. One still open after three
is structural: stop and report it.

**A finding surviving two rounds may be a defect in the criterion, not the
work.** Before a third round, ask whether any output could satisfy it. A
criterion that rejects every attempt for the same reason never converges,
and the work degrades with each round as it contorts toward a test with no
passing answer. Fixing the criterion is your partner's call.

Never fix findings yourself while coordinating: it skips review entirely
and burns context the remaining tasks need. There are two buckets: fix it
now, or record it in the task's `TaskCreate` entry for the final review. A
reviewer may still describe severity in words; what's banned is a third
disposition or a formal adjudication step.

The final review covers cross-task integration and anything deferred, not
lines a per-task review cleared.
