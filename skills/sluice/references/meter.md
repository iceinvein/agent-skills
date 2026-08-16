# Meter the run

Run `scripts/run-stats.sh` as part of the message that hands the work back,
and paste its output into that message unedited:

```
bash <skill-dir>/scripts/run-stats.sh --tests "<what the suite actually printed>"
```

It reads the session transcript, so it needs no state of its own and cannot
drift from what happened. `--tests` is the one field it cannot know: only you
watched the suite run. Fill it from the output you read in this session, and
leave it off entirely if no suite ran, which prints "not reported" rather
than a number nobody checked. `--base <ref>` overrides the diff base when the
merge-base with `main` or `master` is not where this branch actually began.

The run starts at your channel announcement, or at the point this skill was
invoked by name when that came first, not at the session. Three unrelated tasks
in one session therefore report as three runs, and a previous ledger closes the
run before it. `bypass` announces nothing, so there is nothing there to meter,
and the rule does not fire; if you run the script anyway in a session that
loaded the skill, it will happily print a ledger headed `not announced`, which
is a measurement of nothing you were asked to account for.

What the ledger is for: the cost of a channel is otherwise invisible, and a
channel nobody can price is a channel nobody can choose between. Six agents
and four hours of agent wall-clock on a two-file change is the sort of thing
that only becomes obvious once it is written down next to the diff. Expect
some runs to make the case for a shallower channel next time. That is the
ledger working, not the ledger complaining.

The agent line carries a concurrency factor next to the wall-clock: agent time
summed, over the span those agents actually occupied. 1.0× means every agent
had the clock to itself. That is the right number for a plan whose graph was a
chain and a finding for one whose graph was not, so read it against the plan
rather than on its own. Nine agents at 1.0× on a plan with four independent
tasks in it is a run that took four times longer than it needed to. Both
figures cover only the agents the harness timed, so a run whose agents were all
dispatched into the background shows neither.

Agents are priced from two different sources, and the line keeps them apart
rather than adding them. Where the harness priced an agent itself, that is the
figure: it is the accounting the session was billed by and it covers input as
well as output. An agent dispatched into the background is handed back before
it runs, so the harness never priced it at all, and the only record left is the
agent's own transcript. Those rows are marked `~`, count output tokens only,
and carry no wall-clock, because a log holds no duration: its span runs from
first message to last and swallows the idle whenever an agent was resumed.
Adding a `~` figure to a harness figure would produce a number that means
nothing, which is why you will see two totals on one line and never one.

An agent nothing priced reads "cost not reported" and the totals leave it out,
with the count on the agent line. That is a gap in what could be measured
rather than a cheap run, and it needs a sentence from you: a smaller total must
not be allowed to stand for the whole.

Read it before you paste it. A row showing an agent that errored, or an agent
whose token count dwarfs every other row, is a finding about the run and
belongs in your prose, not left for your partner to spot in a table. A row
whose figure is missing or marked is a finding about the ledger, and saying
which of the two you are looking at is the whole job here.

Exit 2 means neither an announcement nor an invocation of this skill was found,
so there was no run to report. That is a fact about the work, not a failure: do
not synthesise a ledger to fill the gap. It can also mean your announcement was
worded in a shape the script does not recognise, so check that it is not simply
missing you before you report the run as nothing. Any other non-zero exit is a
broken tool, not a fact about the work: it prints its reason on stderr, and the
answer is to say the ledger could not be produced rather than to describe the
run from memory.

The friction line: "I know roughly what this cost." Roughly is the problem.
Every number here is already on disk, and the remembered version is reliably
the flattering one.
