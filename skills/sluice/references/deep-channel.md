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
- An **Effort** field, written `**Effort:** low, <why>`, may put the task on
  low effort, and says why the work is mechanical: the Contract is exact, the
  tests it has to satisfy already exist, and nothing in it turns on judgment.
  Omit it and the task runs at this session's effort, so the marked tasks are
  the exceptions rather than the rule. Effort is the lever rather than the
  model because `low` comes close to `medium` on coding for much less, and a
  `**Model:**` line from an older plan is an error, not a downshift.
  Anything the table below sends to tier 3 is disqualified, `Flips` with it:
  those are the tasks where being wrong is expensive, and the saving is not
  worth pricing against that. Mark it here rather than deciding at dispatch,
  because whether a task is mechanical is fixed the moment its Contract and
  Touches are written, and pre-flight is the last point your partner can price
  it.
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

**Run `scripts/plan.sh validate <plan>` on the finished plan, before pre-flight.**
Most of what this section asks for needs no judgement to check: a `Needs` no
task `Offers`, a "TBD", a step deferring to a neighbour, a missing `Contract`,
a plan with no flip or two of them, an `Effort` mark on a task the tier table
sends to tier 3, a `Model` mark anywhere. Those come back as errors with the
task number on them. The warnings are the judgement calls left to you: a step
with no proof, a `Needs` satisfied only by a later task, two tasks whose
`Touches` overlap. Reading the plan yourself catches these on a good day, and
the point of a check is the other kind of day.

```
# Plan: <topic>
## Ground Rules
- <exact value>
### Task N: <name>
**Contract:** Needs: <sig> | Offers: <sig>
**Touches:** <path> (new) | <path> (edit) | <path> (test)
**Flips:** <what changes, from what, or omit>
**Review:** <reason, or omit>
**Effort:** <low, and why the work is mechanical, or omit>
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

## The run record

A `deep` run outlives its own context, so what it learns has to sit on disk
rather than in the session. That lands in two files, and which one a thing goes
in follows from who has to read it.

`.sluice/run.json` holds the state that moves: each task with its status, base
and commit, its tier, its `Effort` mark and its `Flips` line, and the answers
pre-flight settled. `scripts/status.sh` writes and reads it, and
`references/status.md` carries the commands and the statusline segment that
makes a run visible without anyone asking. Open it with `init` when you open
the record, which is after pre-flight and inside the tree the work runs in, the
worktree when pre-flight bought one: a run opened in the main tree before the
worktree exists lives where every later session's `init` collides with it, and
that session cannot tell an abandoned run from yours. One already stranded
there moves with `status.sh move --to <worktree>`. Seed the rows with
`scripts/plan.sh import <plan>` rather than typing a command per task, then
flip each task as it moves. It carries the ids, the names,
the flip, the effort marks and the tiers, the last of these floored off `Touches`
and the contract graph rather than guessed. Import is safe to re-run: a status, a
review mark or a ratified effort already recorded is left alone and a tier is only
ever raised, so resuming after a compaction cannot rewind the run.

The record is the other file, and it holds what a status cannot: the reason
review went the way it did, the reason a task was downshifted, the reason the
workspace answer went that way, any finding belonging to a task other than the
one that surfaced it, and whatever else a stranger resuming tomorrow would need
and could not derive. **It no longer carries task rows with statuses in them.**
Status written in both places drifts, and once it has there are two answers and
nothing to say which is stale.

Pre-flight lands in both, which is the one deliberate overlap: `run.json` holds
the answer, so the file can say whether the stop happened at all, and the record
holds the reason, so a reader can tell whether it should have gone that way.
Those rows come first and open the record for the same reason they always did.

Where it goes follows the repo if the repo has a convention, and
`docs/plans/YYYY-MM-DD-<topic>-record.md` if it does not. It belongs to you
rather than to any task, so it lives in the tree you are working from, no
task's `Touches` names it, and you commit it yourself alongside the plan.
Assembling it at handback defeats it: a record written from memory is memory,
which is the one thing the file exists to replace.

A file only outlives compaction if you go back to it. Run `status.sh show` and
read the record before the next dispatch whenever this session has been
summarised, and treat what they say over what you remember, including where the
two agree. Each task closes by writing its commit into `run.json`, which means
asking the implementer to report the SHA it committed and passing it to
`status.sh task <id> --status done --commit <sha>` rather than deriving it later.

## The design stop and plan mode

The design stop is a stop because a plan written against the wrong design wastes
a plan's worth of work. Sluice enforced it with a sentence, "a stop ends your
turn", which is the weakest gate available in a harness that has a real one.

Claude Code's plan mode is the real one. `EnterPlanMode` needs your partner's
consent to enter, `ExitPlanMode` will not proceed without their approval, and
edits are held shut in between, so the design cannot be quietly built against
while it is still a draft. Take the design stop through it.

What that changes: the design gets drafted in the plan file the harness names,
and `ExitPlanMode` is the sign-off rather than a paragraph asking for one.

What it does not replace is pre-flight. That stop wants three answers, and an
approval is not an answer to any of them, so it stays where it is, after plan
mode has exited and the plan is written. One enforced gate does not collapse two
stops into one; it only makes the first of them hold.

**The harness's plan file is not the artifact.** It belongs to the mode and not
to the run. On approval, write the design to `docs/specs/YYYY-MM-DD-<topic>.md`
and the plan to `docs/plans/YYYY-MM-DD-<topic>.md`. The run record and
`run.json` open after pre-flight, in the tree the work runs in, for the reason
the run record section gives. Those are the durable files, the ones a session
resuming next week reads, and none of them is the one you drafted in.

Where plan mode is unavailable, the prose stop is what you have and it is the
same stop, with one thing you now do yourself: nothing is holding the draft, so
write the design to `docs/specs/YYYY-MM-DD-<topic>.md` before you end the turn
on it. A design that exists only in the message you just sent is gone at the
next compaction, which is what the durable files are for. Write it, end the turn
on it, and let the next instruction start the plan. Nothing else about this
section changes, because the obligation was never the mode's, only the
enforcement was.

## Pre-flight

Design signed off, plan written, nothing built yet. Before Task 1, stop once
and settle three things with your partner. Ask them as questions with options,
not as a paragraph they have to reply to in prose: what you are after is a
decision, and a wall of considerations asks them to extract the decision from
it first.

This stop is the plan's sign-off as well, so it ends your turn, and a
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
only at tier 3, or hand back with the whole tier table skipped. The options are
what makes the cost legible.

Whichever comes back, record it with `status.sh preflight --review`. That row is
what turns the tasks it skips into a coverage level rather than a debt: the count
stays, because the code is the same either way, but `show`, the bar and `close`
then name it as the level your partner chose. Unrecorded,
the same tasks read as unreviewed to the end of the run, which is a nag about a
decision that was already made. `references/status.md` has the two readings.
"Four of nine need a reviewer" is a decision your partner can price; "I will
review where appropriate" is not.

**Effort.** The plan already marked which tasks are mechanical, so this is a
ratification rather than a fresh judgment, and it carries the count: six of
nine at low effort and three at this session's, take it, put everything at the
session's effort, or name the exceptions. The count is what your partner
prices. "I will use low effort where it fits" prices nothing, and it also
arrives after the tokens are spent.

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

That question settles where the implementers run, not whether a task may be
dispatched at all, and the shared-tree and current-branch options have to say
so: under either, a single task still goes to its own agent where the reading
would otherwise land here, announced when it happens. Put it in the option text
rather than leaving it to be inferred. Unsaid, it is not in what your partner
agreed to, and a session that dispatches only when asked then has to stop
mid-run to ask for the one dispatch that would have paid. Do not name the tasks
here: which one turns out read-heavy is not knowable yet, and a list written now
is the declared schedule the dispatch rules reject.

If one of the two has only one live answer, say which and ask the other. A stop
down to a single question is still a stop.

**Write the answers down before Task 1's first edit, in the tree the work runs
in.** The order on the instruction that follows the stop: cut the worktree
first, when that was the answer, through the harness's worktree tool, which
puts this session inside it: everything below is issued from there, and issued
from the main tree instead it lands in the tree the work is not in. A fresh
worktree branches from the remote's default branch, so nothing uncommitted or
unpushed in the main tree comes across, and `docs/` may not exist there yet.
Move the design and plan into it yourself, each into its own directory since
the two share a basename and one `mv` into one directory would leave the plan
where the design was:

```
mkdir -p <worktree>/docs/specs <worktree>/docs/plans
mv docs/specs/YYYY-MM-DD-<topic>.md <worktree>/docs/specs/
mv docs/plans/YYYY-MM-DD-<topic>.md <worktree>/docs/plans/
```

The main tree is then clean and the worktree holds the only copy. Then `init`,
`plan.sh import` and `status.sh preflight` from inside it; then the record
with the reason each answer went that way; then commit design, plan and record
there, on the branch the work is on rather than on master. Both files carry the
answers: `status.sh preflight` for what was decided, the run record for why.
That pair is what discharges pre-flight, rather than the
approval you got, and the distinction is the whole point: a stop
that carries the plan and pre-flight together has one reply for two obligations,
so a bare "yes" satisfies the plan and leaves no trace either way of the
questions. Rows in a file leave that trace. If Task 1 is about to open and the
record has nothing in it, you did not ask, however clearly you remember
intending to, and the questions are still cheap here and unaskable an hour from
now.

A session that forbids subagents does not skip this; it changes what the
review options are. Skipping it is how the unreviewed count first appears in
the closing summary, at the one moment your partner can no longer do anything
about it, and with no answer on file it stays worded as a debt rather than as
the level anyone chose.

## Dispatch rules

Read the plan as a graph before you read it as a list. `Needs` and `Offers`
are dependency edges, not only blindness insurance: a task is ready when every
`Needs` it names is offered by a task already done, and any two ready tasks
with disjoint `Touches` can go at the same time.

**`scripts/status.sh ready` does that read.** It prints the ready set, names which
of them share a path and so cannot go together, says which tasks are still waiting
on a contract and what for, and holds the flip out of every wave. Run it before
each wave rather than deriving it again by hand, and note that it also checks the
candidates against whatever is already `active` or in `review`: those hold their
paths too, and a wave checked only against itself reads as safe while colliding
with work in flight. A plan run in the order it happened to be written is a plan whose
graph nobody looked at, and inert-first ordering tends to put the independent
tasks at the front, so the opportunity is usually real.

Derive the sets at dispatch rather than writing wave numbers into the plan. A
declared schedule is wrong the moment one task lands late or comes back with a
blocking finding. A derived one just recomputes, which is the whole reason `ready`
reads the run state rather than the plan: it sees what has actually landed.

- One row per task in `run.json`, and you are the one who flips it; an
  implementer reports, it does not write the run state. `active` at dispatch,
  which records the base as the HEAD of the tree the command is pointed at
  unless you pass `--base`. `review` when the task's commit is in and its
  reviewer has gone out: the paths stay held, because a finding may send the
  implementer back into them. `done --commit <sha> --reviewed` when the review
  clears, or `done --commit <sha>` alone for a tier 0 task, which was owed a
  stat read and no dispatch, and for a task whose dispatch pre-flight declined;
  the count counts the second kind and not the first. A declined dispatch is
  meant to show up there, because the count describes the artifact rather than
  the decision, and the recorded pre-flight answer is what makes it read as
  coverage rather than debt. That state outlives compaction; your memory doesn't.
- Each task goes to a fresh agent carrying the brief below and nothing this
  session accumulated. What you hold is yours to hold, not theirs.
- **The run never ends a turn between pre-flight and the handback.** A
  message with no tool call in it ends the turn, whatever it says, and a run
  handed back that way stands still until your partner notices, which
  overnight is the next morning. So an announcement rides in the same message
  as the dispatch it announces, a wave's completion is followed in the same
  message by `status.sh ready` and the next dispatch, and a status note goes
  in the same message as the next tool call. Four early stops read as a
  natural place to end and are not one: a summary of what landed that
  announces the next step without taking it, so "T4 goes next" is the last
  thing said and T4 never starts; an offer to carry on unless your partner
  would prefer otherwise; a list of decisions none of which blocks the rest,
  when the work they do not block could go on while they are answered; and
  deciding this is a good place to report because the turn has been long or a
  milestone landed. The turns that do end are the two stops, a task marked
  `blocked` because it genuinely needs your partner, a pause recorded with its
  reason, and the handback. Everything else that has to wait on them goes
  through one of those two doors: a finding still open after three review rounds marks its
  task `blocked`, and re-dispatching it flips the row back to `active` when
  your partner has answered; a mid-run request for a dispatch, or a
  show-or-say offer, is a pause, `status.sh pause --reason "<why>"`, so the reason is on disk and
  the Stop hook lets you go, with `resume` when it moves again. The hook
  refuses once per turn and then lets the next attempt through, so it is a
  nudge with the state in it rather than a wall: the rule is yours to keep.
- **Label the dispatch `T<n>: <task name>`.** The harness lists running agents
  under whatever label the dispatch gave them, so labelled by task that list
  reads as the plan and labelled anything else it reads as a row of anonymous
  agents. It costs nothing and it is the only place a partner can see which
  task is in flight without asking.
- **Fan out wherever the graph allows.** Work that does not write is always
  safe and always parallel: investigations, searches and reviewers, one agent
  per question, all in one message so they run at once.
- **A single task can still be dispatched from a shared tree.** What that
  answer bought was serial implementers, and one agent at a time satisfies it,
  so the escalation stays open per task instead of being foreclosed at
  pre-flight. Take it where the reading dwarfs the diff: the task's own text
  calls for a survey before the edit, its gates are the noisy ones, or this
  session has already been summarised once and what is left is scarce. Say it
  out loud and put the row in the run record with its reason, because otherwise
  the record says controller-run and the transcript says otherwise.
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
  tool, not `git worktree` yourself. That tool moves this session into the
  worktree, which `git worktree add` does not: cut by hand, the files are
  isolated and the session is still in the tree they came from, so every bare
  `git`, build and test command you run lands in the wrong one. Enter it by
  path if it already exists. Implementing straight onto main or
  master needs your partner's say-so, which pre-flight is where you got, and
  it forecloses concurrent implementers for the whole run. Cut it before the
  run opens, so the state lives in it. A worktree cut after `init` still reads
  the main tree's run, so nothing breaks for you, but the run stays in the main
  tree where the next session to start a `deep` run finds it blocking `init`;
  `status.sh move --to <worktree>` puts it where it belongs, and the session
  has to follow it there.
- **The agent that built the task commits it**, once its own tests pass, and
  only the paths in its `Touches`. Never `git add -A`: the tree is shared, and
  on a branch you did not isolate it holds work that is not this task's. The
  agent committing is the default rather than you committing, because
  authoring a message for a diff you did not write means reading that diff,
  which is the context dispatch exists to keep out of this session. Pre-flight
  can overturn it for a given run.
- **The plan and pre-flight decide the effort, not the moment of dispatch.** A
  task with no `Effort` line goes out on this session's model and effort, and a
  downshift that was neither marked nor ratified is a saving your partner never
  agreed to. A task ratified at `Effort: low` goes out with
  `subagent_type: sluice-implementer-low`, the agent sluice installs with
  `effort: low` and `model: inherit`: the Agent tool takes a model and no
  effort, so an agent definition is the one place a dispatch's effort can be
  set. Reviewers are the
  other half of that rule: a review never runs below the effort that built the
  task, so the review of an `Effort: low` task goes out on this session's
  effort and never on the low agent.

A per-task commit is not an integration event. `references/finish.md` owns
push, PR and merge, none of which happen here, and a standing instruction to
commit only when asked is about that outward-facing act. The plan's sign-off
is the asking. Nothing a task commits reaches anywhere your partner has not
already agreed to, so the instruction is satisfied rather than excepted.

## The dispatch brief

An implementer sees its task and nothing else, so anything it has to obey that
is not in the task text has to be in the brief. The rules it would otherwise
never meet are the ones this skill spends the most words on, and an agent that
never loaded the skill follows none of them by default. The brief carries, in
this order:

- **Ground Rules**, verbatim from the plan. They bind every task and are
  repeated in none, so the brief is where they reach the implementer.
- **The task**, whole: heading, Contract, Touches, Flips, steps.
- **The implementer contract**, five lines that are the same for every task:
  the test comes first and is watched failing before the code
  (`references/test-first.md`, one paragraph of it, not a pointer the agent
  cannot follow); nothing outside `Touches` is edited; the commit stages only
  the paths in `Touches`, never `git add -A`; the reply reports the commit SHA
  and names any behaviour left untested and why; and `.sluice/` is not written,
  the run state being yours to flip.
- **The label**, `T<n>: <task name>`, on the dispatch itself.

Leave out how you got here. The design, the record, the other tasks and this
session's reasoning are what dispatch exists to keep out of the implementer's
context, and a brief that carries them has spent the fresh context it was
buying.

## When dispatch is unavailable

Separate two cases first. A session where dispatch is off unless your partner
asks for it is not this section: it is the pre-flight review question, and
answering it is theirs to do. This section is dispatch being genuinely
unavailable, where there is nothing to ask.

`deep` then loses most of the machinery this file describes, and the place to
say so is the routing announcement, where your partner can still act on it,
not the summary at the end where it reads as an excuse.

Three things change. The plan stops being a brief for strangers and becomes
your own worklist, so its stop is no longer buying alignment with the agents
who will carry it out, only your partner's read of work you will do yourself.
Task isolation is gone, so
`run.json` and the record now carry all of the state that outlives compaction
and matter more, not less. And fresh context is unavailable, which was the entire thing
review was buying.

One thing does not change: the work still owes a review. Reading your own diff
is not one, and the table below still names which tasks needed the stronger
tier. Name those tasks at pre-flight, not at handback, so the choice of what
to do about them is still open: shrink the plan, take the flip on its own, or
accept the gap knowingly. Record the answer with `preflight --review` and say at
the handback what was covered and how, rather than claiming those tasks passed a
review; twice is the cap on saying so here too, and `references/review.md` has
that rule. A `deep` run that ships with nobody
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
| 0 | Created files only, tests that meet `references/test-first.md` exist and pass, Contract matches | No dispatch. Read the commit stat yourself. |
| 1 | Modified existing code, or later tasks build on it | One reviewer dispatch |
| 2 | No executable test covers it: prose, config, docs | One reviewer dispatch; a stat cannot confirm the words are right |
| 3 | Auth, data, money, concurrency, or the plan flags it | One reviewer dispatch; the task may not be downshifted |
| 3 | Carries the `Flips` line | One reviewer dispatch; the task may not be downshifted |

No tier buys a bigger model or more effort, because a plan that downshifted
nothing has every agent on the session's model and effort, and a tier promising
something stronger would be promising what is already in use. What a tier buys
is a dispatch. The one effort rule that holds across all of them is that a
review never runs below the effort that built the task, so tiers 1 and 2 over
an `Effort: low` task go out at this session's effort rather than on
`sluice-implementer-low`.

**Where the repo carries review tiering of its own, this table governs.** It is
the more specific of the two: wired into `Flips`, the `Effort` marks and the
count pre-flight prices, so a repo's tiers cannot be honoured without unpicking
those. The usual clash is a repo tier that buys a bigger model or more effort
for its risky tasks, and it loses to the effort rule above for the reason given
there. What the repo keeps is everything this table does not cover, which is most of what
such rules are for: its gate on deterministic checks before a task reports
done, the shape of its skip ledger, what it does after a fix round that touched
no logic. Take the dispatch decision from here and the rest from there, and say
in the pre-flight count which side each came from.

A task matching more than one row takes the highest tier of them. Tier is the
number, not the row order and not which shape sounds more serious. A task that
only creates files but ships prose is tier 2, and a suite re-bless paired with
an ADR is tier 2 rather than the free row it resembles.

**A test written to earn tier 0 does not earn it.** The row is a discount on
review, and a task whose only executable test fails
`references/test-first.md`'s question, that some plausible change to the code
turns it red, is a tier 2 task carrying a green line rather than a covered
one. Price it as tier 2. Buying this table's savings with the one kind of test the rest of the
skill argues against is the cheapest way to lose them.

Ordering inert tasks first is what keeps this affordable. An inert task that
only creates files takes tier 0, so a nine-task plan usually buys three
or four dispatches rather than nine. If most of your plan qualifies for a
dispatch, the tasks are interleaved rather than ordered, and reordering them
is cheaper than reviewing them.

**Mark each review with `status.sh task <id> --reviewed` when it comes back.**
What that buys is a count of the tasks this table sent to a reviewer and nobody
marked: done, qualified for a dispatch, and carrying no mark. `show` and the
statusline both carry it from the moment it exists, which is the whole point.
Unmarked, the count sits permanently non-zero and stops being a signal, and it
goes back to first appearing in the closing summary, at the one moment your
partner can no longer do anything about it.

With the pre-flight answer on file the same count is the coverage this run
bought, worded as such and drawn dim. Without it the count is a debt and stays in
the warning colour. Neither wording shrinks it: what changes is whether the
number reads as spent or as owed.

Reviews are reads, so they are always parallel. Every review a wave earned
goes out in one message, and they run while the next wave's implementers work:
a reviewer writes nothing, so it collides with nothing. The final review is
the only one that waits, because it is the only one that needs everything to
have landed.

The base is recorded when the task goes `active`: the flip takes the HEAD of
the tree it is pointed at, `--dir` if you passed one and the tree you issued it
from otherwise, so point it at the tree the implementer is cut from, or pass
`--base <sha>` where that differs. Recovering it afterwards is
archaeology, and the answer you will guess at is `HEAD~1`, which
`references/review.md` already names as the standing mistake.

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

Record it against the earlier task in the run record, and send it to that
task's agent as well if that agent is still live. If it invalidates an `Offers` that
later tasks have already built against, it has stopped being a finding and
become a plan change, which is your partner's call rather than something to
absorb into the next task's brief.

## The final review

It runs once every task is `done` and every per-task review is back, and it
comes before `references/finish.md` starts: the suite run there is the last
check before the three options, and a review that lands after it would be
reviewing a tree the suite never saw. Mark it with `status.sh final` when it
clears, so `show` and `close` report it done rather than pending; the per-task
marks cannot stand in for it, because they count dispatches the tier table owed
and this one is owed by the plan as a whole.

It covers cross-task integration and everything the record accumulated, not
lines a per-task review already cleared. It is a dispatch, on this session's
model and effort and never a downshifted one, and it gets the whole-plan diff
and the deferred findings as a list.

Size the brief to what it is actually carrying, and say which of two things it
is. After nine per-task reviews cleared, it is an integration check. When
pre-flight chose to skip per-task reviews, it is the only review the plan will
ever get. Sending the same brief to both is how a plan ends up with one skim
standing in for nine reviews.
