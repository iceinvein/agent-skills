# Deep channel

## Plan format

- A plan opens with **Goal**, **Architecture** and **Ground Rules**. The ground
  rules are the limits the whole plan answers to, each recorded at its literal
  value, and each one binds every task without being repeated in it.
- No implementer sees a neighbouring task, so each task carries a
  **Contract**: a symbol absent from it does not exist for whoever builds
  the task. Not optional. `Needs` names what this task calls but another
  task defines; `Offers` names what later tasks will call. Both sides are
  spelled out whole, argument lists and return shapes.
- A **Touches** line lists the exact paths the task creates, edits and tests.
- A **Review** field may name why the task needs the stronger tier (auth,
  data, money, concurrency); the table below decides otherwise.
- Steps are checkboxes: an action, and the proof it worked. Skip the
  test-first ritual per step; `references/test-first.md` owns it.
- Code goes in only where exact characters matter and paraphrase breaks
  something: a signature, a literal the code must match, a command, a test
  body. Prose deliverables get their claims and their length, not a draft.
- A step a stranger could not carry out from its own text is unfinished.
  "Same as Task 3" is one such step: tasks get read out of order, so write
  the instruction out again in full. "TBD" is another. So is naming a type
  or a function that no task in the plan ever creates.

```
# Plan: <topic>
## Ground Rules
- <exact value>
### Task N: <name>
**Contract:** Needs: <sig> | Offers: <sig>
**Touches:** <path> (new) | <path> (edit) | <path> (test)
**Review:** <reason, or omit>
- [ ] <action> -> <proof>
```

## Dispatch rules

- One `TaskCreate` per task, marked in progress then complete. That state
  outlives compaction; your memory doesn't.
- Each task goes to a fresh agent with that task's text and nothing else.
  What this session accumulated is yours to hold, not theirs.
- **Never run two implementers at once.** They collide in the same files.
- Fan out for work that doesn't write: investigations or searches, one
  agent per question, all dispatched in one message so they run at once.
  The test: could two agents touch the same file?
- Isolate the workspace before a multi-task plan: the harness's worktree
  tool, not `git worktree` yourself. Implementing straight onto main or
  master needs your partner's say-so.
- Match model to task: cheap for mechanical work, stronger for judgment
  and final review.

## Review policy

A review costs about what the implementation cost, so reviewing every task
doubles the plan. Confirming Offers landed and nothing outside Touches moved
is free, one `git diff --stat`; only quality judgment needs a dispatch.

| Task shape | Review |
|------------|--------|
| Created files only, executable tests exist and pass, Contract matches | No dispatch. Read the diff stat yourself. |
| Modified existing code, or later tasks build on it | One reviewer dispatch |
| Auth, data, money, concurrency, or the plan flags it | One reviewer dispatch, stronger model |
| No executable test covers it: prose, config, docs | One reviewer dispatch; a diff stat can't confirm the words are right |

A task that matches more than one row takes the strongest review of them.

The diff goes to disk and the reviewer gets its path: `git diff <base>
<head> > <file>`. Base means where that task began, which is why `HEAD~1` is
wrong: on a five-commit task it shows the fifth and buries the rest.
Findings return to whoever wrote the code.

**Most fixes are too small to earn a second review.** Read the fix diff
yourself and check the test it names ran; dispatch again only for
substantial logic changes. Three rounds is the cap either way: a finding
still open then is structural, so escalate it to your partner.

**A finding surviving two rounds may be a defect in the criterion, not the
work.** Before a third round, ask whether any output could satisfy it. A
criterion that rejects every attempt the same way never converges, and the
work degrades each round as it contorts toward an unpassable test. Fixing
the criterion is your partner's call.

Never hand yourself a finding to fix while you are the one coordinating.
Coordination and repair are separate jobs, and doing both leaves your own
patch as the one nobody reviewed, bought with context the later tasks are
going to need. A finding has two destinations: fixed now by the agent that
wrote it, or recorded in the task's `TaskCreate` entry for the final review.
A reviewer may describe severity in words; a third disposition is not
available, and neither is any step for adjudicating findings into one.

The final review covers cross-task integration and anything deferred, not
lines a per-task review cleared.
