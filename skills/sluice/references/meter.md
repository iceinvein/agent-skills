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

The run starts at your channel announcement, not at the session, so three
unrelated tasks in one session report as three runs. A previous ledger closes
the run before it. `bypass` announces nothing, so there is nothing to meter
and the script exits quietly.

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
tasks in it is a run that took four times longer than it needed to.

An agent dispatched into the background is handed back before it runs, so the
result the session sees carries no cost at all. The ledger reads that agent's
own transcript instead, which is why a plan run entirely on dispatched agents
still prices. Agent rows count output tokens, the same unit the run reports for
itself, so they can be read against each other and against the run.

Where that log has been cleaned up the row reads "cost not reported", the
totals leave it out, and the agent line carries the count. That is a gap in
what could be measured rather than a cheap run, and it needs a sentence from
you: a smaller total must not be allowed to stand for the whole.

Read it before you paste it. A row showing an agent that errored, or an agent
whose token count dwarfs every other row, is a finding about the run and
belongs in your prose, not left for your partner to spot in a table.

Exit 2 means neither an announcement nor an invocation of this skill was found,
so there was no run to report. That is a fact about the work, not a failure: do
not synthesise a ledger to fill the gap.

The friction line: "I know roughly what this cost." Roughly is the problem.
Every number here is already on disk, and the remembered version is reliably
the flattering one.
