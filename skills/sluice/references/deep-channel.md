# Deep channel

## Plan format

- A plan opens with **Goal**, **Architecture** and **Global Constraints**:
  exact-value, project-wide requirements every task inherits.
- A **Touches** line lists the exact paths the task creates, edits and
  tests.
- A **Contract** line is never omitted: `Needs` for symbols another task
  defines and this one calls, `Offers` for what later tasks call, both
  written out in full, argument lists and return shapes. No implementer sees
  a neighbouring task, so a symbol missing here does not exist for them.
- A **Review** field may name why the task needs the stronger tier (auth,
  data, money, concurrency); the table below decides otherwise.
- Steps are checkboxes: an action, and the proof it worked. Skip the
  test-first ritual per step; `references/test-first.md` owns it.
- Code goes in only where exact characters matter and paraphrase breaks
  something: a signature, a literal the code must match, a command, a test
  body. Prose deliverables get their claims and their length, not a draft.
- A step a stranger could not carry out from its own text is unfinished.
  "Same as Task 3" fails that, since tasks get read out of order, so write
  it out again; so does "TBD"; so does naming a type or function no task
  creates.

```
# Plan: <topic>
## Global Constraints
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

Coordinating and fixing are separate jobs. Do both and your own patch is the
one nobody reviews, paid for out of context later tasks need. A finding has
two destinations: fixed now by the agent that wrote it, or recorded in the
task's `TaskCreate` entry for the final review. A reviewer may describe
severity in words; a third disposition or formal adjudication step is banned.

The final review covers cross-task integration and anything deferred, not
lines a per-task review cleared.
