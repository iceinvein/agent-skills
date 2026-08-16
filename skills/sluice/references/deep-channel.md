# Deep channel

## Plan format

- A plan opens with **Goal**, **Architecture** and **Ground Rules**. The ground
  rules are the limits the whole plan answers to, each recorded at its literal
  value, and each one binds every task without being repeated in it. The commit
  message convention is one of them, written out at literal value along with
  anything the repo forbids a message from carrying. An implementer arrives
  with its own defaults and will use them on anything you left unsaid.
- No implementer sees a neighbouring task, so each task carries a
  **Contract**, not optional: a symbol absent from it does not exist for
  whoever builds the task. `Needs` names what this task calls but another
  task defines; `Offers` names what later tasks will call. Both sides are
  spelled out whole, argument lists and return shapes. They are also the
  plan's dependency edges, which is what dispatch order gets derived from.
- A **Touches** line lists the exact paths the task creates, edits and tests.
  Complete, not indicative: it decides which tasks may run at the same time,
  so a path left off it has stopped being an untidy diff stat and become a
  corrupted concurrent run.
- A **Review** field may name why the task needs the stronger tier (auth,
  data, money, concurrency); the table below decides otherwise.
- **Order the plan so the inert tasks come first.** A task is inert when it
  adds capability, config, a schema or a code path that nothing reads yet:
  landing it changes no observable behaviour, so it is safe to land alone and
  safe to leave landed. Exactly one task turns the new behaviour on, and it
  carries a **Flips** line saying what changes and what it changes from.
  Tasks after it build on the new behaviour and are no longer inert.
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
**Flips:** <what changes, from what, or omit>
**Review:** <reason, or omit>
- [ ] <action> -> <proof>
```

One `Flips` line pays for itself at the far end of the plan. When a late task
re-baselines something, regenerated fixtures, re-blessed snapshots, a golden
file that now reads differently, the flip is what the new baseline is
attributable to, a single point rather than a diffuse property of the branch.
Without it, whoever reads the branch later has to derive that ordering from
the diff, and they will derive it wrong.

Two tasks carrying `Flips` means the plan holds two branches' worth of work.
Split it. A plan with none is not a `deep` plan: nothing in it does anything.

## Pre-flight

Design signed off, plan written, nothing built yet. Before Task 1, hand back
once and settle two things with your partner. Ask them as questions with
options, not as a paragraph they have to reply to in prose: what you are after
is a decision, and a wall of considerations asks them to extract the decision
from it first.

This handback is the plan's sign-off as well, so it ends your turn, and a
question tool does not end it for you. That tool returns an answer without
returning control: two options came back, the plan itself did not, and your
partner reads the summary of it in the same message as Task 1's first edit,
by which point their only remaining move is to interrupt. Ask the questions,
then end the turn on the answers and let the next instruction start the
build. If the answers arrive with that instruction already attached, you have
your sign-off and Task 1 begins.

**Review.** Name the tasks the table below sends to a reviewer, each with the
trigger that qualified it, and say how many of the rest skip with a ledger
line. Then offer the choice: dispatch a reviewer at each of them, dispatch
only at the stronger-model tier, or hand back with those tasks listed as
review outstanding. The options are what makes the cost legible.
"Four of nine need a reviewer" is a decision your partner can price; "I will
review where appropriate" is not.

**Workspace, commits and concurrency.** One worktree for the plan, one per
concurrent implementer, or straight onto the current branch; and with it who
commits, each agent committing its own task as it finishes or agents leaving
the tree dirty for you to read and commit yourself. One question rather than
three, because isolation is what gates the other two: a shared tree means
serial implementers, and the current branch means serial and your commits.
Say how many tasks the graph says could actually overlap, because a worktree
per implementer is only worth buying if the plan has parallelism to spend it
on. Agents committing into a worktree is cheap and easy to
discard; the same on master is a different proposition, and that is the pairing
your partner needs in front of them. Implementing onto main or master needs
their say-so and this is where you get it. Known friction in a worktree for this
repo, a lint target that resolves through a symlink, a build that needs its own
install, belongs in the option text where it can affect the answer, not in a
footnote after they have chosen.

If one of the two has only one live answer, say which and ask the other. A
checkpoint down to a single question is still a checkpoint.

A session that forbids subagents does not skip this; it changes what the
review options are. Skipping it is how "review outstanding" first appears in
the closing summary, at the one moment your partner can no longer do anything
about it.

## Dispatch rules

Read the plan as a graph before you read it as a list. `Needs` and `Offers`
are dependency edges, not only blindness insurance: a task is ready when every
`Needs` it names is offered by a task already done, and any two ready tasks
with disjoint `Touches` can go at the same time. Do that read once, before
Task 1. A plan run in the order it happened to be written is a plan whose
graph nobody looked at, and inert-first ordering tends to put the independent
tasks at the front, so the opportunity is usually real.

Derive the sets at dispatch rather than writing wave numbers into the plan. A
declared schedule is wrong the moment one task lands late or comes back with a
blocking finding. A derived one just recomputes.

- One `TaskCreate` per task, marked in progress then complete. That state
  outlives compaction; your memory doesn't.
- Each task goes to a fresh agent with that task's text and nothing else.
  What this session accumulated is yours to hold, not theirs.
- **Fan out wherever the graph allows.** Work that does not write is always
  safe and always parallel: investigations, searches and reviewers, one agent
  per question, all in one message so they run at once.
- **Concurrent implementers need a worktree each.** Disjoint `Touches` is
  necessary and no longer sufficient: agents commit their own tasks, so two
  in one tree contend on the git index and on `HEAD` even when their files
  never meet. One worktree per concurrent implementer, or run them serially.
  Those worktrees cost something, which is why pre-flight asks rather than
  assumes.
- **The flip runs alone.** Nothing goes concurrent with the task carrying
  `Flips`. The invariant it establishes is what later tasks are checked
  against, and whatever landed beside it was checked against nothing.
- Isolate the workspace before a multi-task plan: the harness's worktree
  tool, not `git worktree` yourself. Implementing straight onto main or
  master needs your partner's say-so, which pre-flight is where you got, and
  it forecloses concurrent implementers for the whole run.
- **The agent that built the task commits it**, once its own tests pass, and
  only the paths in its `Touches`. Never `git add -A`: the tree is shared, and
  on a branch you did not isolate it holds work that is not this task's. The
  agent committing is the default rather than you committing, because
  authoring a message for a diff you did not write means reading that diff,
  which is the context dispatch exists to keep out of this session. Pre-flight
  can overturn it for a given run.
- Match model to task: cheap for mechanical work, stronger for judgment
  and final review.

A per-task commit is not an integration event. `references/finish.md` owns
push, PR and merge, none of which happen here, and a standing instruction to
commit only when asked is about that outward-facing act. The plan's sign-off
is the asking. Nothing a task commits reaches anywhere your partner has not
already agreed to, so the instruction is satisfied rather than excepted.

## When dispatch is unavailable

Separate two cases first. A session where dispatch is off unless your partner
asks for it is not this section: it is the pre-flight review question, and
answering it is theirs to do. This section is dispatch being genuinely
unavailable, where there is nothing to ask.

`deep` then loses most of the machinery this file describes, and the place to
say so is the routing announcement, where your partner can still act on it,
not the summary at the end where it reads as an excuse.

Three things change. The plan stops being a brief for strangers and becomes
your own worklist, which makes its handback the only outside read it will ever
get rather than a formality on the way to dispatch. Task isolation is gone, so
`TaskCreate` now carries all of the state that outlives compaction and matters
more, not less. And fresh context is unavailable, which was the entire thing
review was buying.

One thing does not change: the work still owes a review. Reading your own diff
is not one, and the table below still names which tasks needed the stronger
tier. Name those tasks at pre-flight, not at handback, so the choice of what
to do about them is still open: shrink the plan, take the flip on its own, or
accept the gap knowingly. Whatever is left then gets listed as review
outstanding rather than review passed, and twice is the cap on saying so here
too: `references/review.md` has that rule. A `deep` run that ships with nobody
having read it has become a `fast` run with a design document attached, and
your partner is entitled to know that while it can still change the plan.

## Review policy

`references/review.md` owns the mechanics every review shares: what to send,
the two destinations and the grade that sorts them, findings going back to
whoever wrote the code, and the three-round cap. This section is only what
`deep` adds on top, which is the tiering. It does not restate the rest, and
where it once did, the two copies had already drifted apart.

A review costs about what the implementation cost, so reviewing every task
doubles the plan. Confirming `Offers` landed and nothing outside `Touches`
moved is free, one `git show --stat` over the task's commits; only quality
judgment needs a dispatch. `git diff --stat` is the wrong reach now that the
agent commits its own task: it reports a clean tree and confirms nothing,
and it fails by printing success rather than by erroring.

| Tier | Task shape | Review |
|------|------------|--------|
| 0 | Created files only, executable tests exist and pass, Contract matches | No dispatch. Read the commit stat yourself. |
| 1 | Modified existing code, or later tasks build on it | One reviewer dispatch |
| 2 | No executable test covers it: prose, config, docs | One reviewer dispatch; a stat cannot confirm the words are right |
| 3 | Auth, data, money, concurrency, or the plan flags it | One reviewer dispatch, stronger model |
| 3 | Carries the `Flips` line | One reviewer dispatch, stronger model |

A task matching more than one row takes the highest tier of them. Tier is the
number, not the row order and not which shape sounds more serious. A task that
only creates files but ships prose is tier 2, and a suite re-bless paired with
an ADR is tier 2 rather than the free row it resembles.

Ordering inert tasks first is what keeps this affordable. An inert task that
only creates files takes tier 0, so a nine-task plan usually buys three
or four dispatches rather than nine. If most of your plan qualifies for a
dispatch, the tasks are interleaved rather than ordered, and reordering them
is cheaper than reviewing them.

Reviews are reads, so they are always parallel. Every review a wave earned
goes out in one message, and they run while the next wave's implementers work:
a reviewer writes nothing, so it collides with nothing. The final review is
the only one that waits, because it is the only one that needs everything to
have landed.

Record the base in the task's `TaskCreate` entry when you dispatch, before the
agent's first commit lands. Recovering it afterwards is archaeology, and the
answer you will guess at is `HEAD~1`, which `references/review.md` already
names as the standing mistake.

**A finding surviving two rounds may be a defect in the criterion, not the
work.** Before a third round, ask whether any output could satisfy it. A
criterion that rejects every attempt the same way never converges, and the
work degrades each round as it contorts toward an unpassable test. Fixing
the criterion is your partner's call.

## What the reviewer is asked

The tier buys a dispatch; it does not say what the dispatch is for. Name the
claim the review has to settle, and it differs by row:

- **Tier 0**, spot-checked rather than dispatched: that the task is actually
  inert. The claim is that nothing observable changes when this lands by
  itself, and one caller already reaching the new path falsifies it.
- **Tier 1**: that `Offers` matches what the plan promised later tasks, since
  those tasks are being built blind against exactly that signature.
- **Tier 2**: that the words are true of the code as it now stands. That is
  the whole reason the row exists and the one claim no stat reaches.
- **Tier 3, `Flips`**: that the invariant the flip establishes holds, and
  holds from that commit onward rather than only under the test the task
  wrote for itself.
- **Tier 3, everything else**: whatever the trigger was. A task flagged for
  concurrency gets asked about concurrency.

## A finding about another task

Contracts mean tasks are built blind, so a reviewer reading Task 6 will
sometimes be right about Task 2. That finding fits neither destination: Task
6's agent cannot act on it, and it does not quietly become yours to fix.

Record it on the earlier task's `TaskCreate` entry, and send it to that task's
agent as well if that agent is still live. If it invalidates an `Offers` that
later tasks have already built against, it has stopped being a finding and
become a plan change, which is your partner's call rather than something to
absorb into the next task's brief.

## The final review

It covers cross-task integration and everything the record accumulated, not
lines a per-task review already cleared. It is a dispatch, on the stronger
model, and it gets the whole-plan diff and the deferred findings as a list.

Size the brief to what it is actually carrying, and say which of two things it
is. After nine per-task reviews cleared, it is an integration check. When
pre-flight chose to skip per-task reviews, it is the only review the plan will
ever get. Sending the same brief to both is how a plan ends up with one skim
standing in for nine reviews.
