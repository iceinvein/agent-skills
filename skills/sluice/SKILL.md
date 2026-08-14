---
name: sluice
description: Use at the start of any request that changes code. Routes the work into one of four channels (bypass, fast, main, deep) by change shape, and applies only the rules that channel needs. Also use when asked to work faster or with less process.
---

# Sluice

A sluice sorts material by size into channels and meters what flows through.
Same here: pick the channel the change needs, pay for nothing else.

## Route first

Pick a channel from the change's shape, state it in one line, then proceed. The
announcement is how your partner redirects you without being asked.

| Channel | Signal | Rules | Say |
|---------|--------|-------|-----|
| `bypass` | No code change: a question, an explanation, a read | none | nothing, just answer |
| `fast` | Existing interfaces, one subsystem (a new flag on an existing command still counts as existing) | test-first, verify | "Fast channel, existing interfaces. Test first, then implement." |
| `main` | Adds an interface, or crosses subsystems | + agree intent, review before merge | "Main channel, new interface. Agreeing the shape first." |
| `deep` | Several subsystems, or a plan was asked for | + written design and plan | "Deep channel, several subsystems. Design before code." |

`bypass`, `fast`, and `main` proceed without stopping for approval; only
`deep` stops. It stops for design sign-off before code, again for the plan
when agents rather than you will carry it out, and once more at pre-flight
before Task 1, to settle review and workspace.

Name the channel and the signal that actually routed you there. The strings above
are examples, not fixed copy, and a channel with a two-part signal should say
which part applied. `bypass` says nothing at all, because a question that gets
announced stops being a question.

**`root-cause`, `finish` and `meter` are not channel-assigned.** The code
misbehaving triggers the first: a bug report, a red test, behaviour you cannot
account for. An integration event, merging, pushing, or opening a PR, triggers
the second. Handing the work back triggers the third, whether or not it ever
reaches an integration event. The first two fire in every channel, `bypass`
included; `meter` cannot, because `bypass` announces nothing to measure from.

## The rules

One line each. Read the reference only on friction: the moment you notice
yourself wanting to skip the rule, or arguing that this one is the exception.

- **Agree intent** before building. One question at a time. Propose approaches
  with a recommendation, not a survey. `main` agrees in a message, `deep` writes
  it down. `references/intent.md`
- **Test first.** The test comes before the code; run it while it should
  still be failing, then write the least code that turns it green. Skip that
  watching step and a green result is only an unchecked guess.
  `references/test-first.md`
- **Root cause** before fix. A fix that only hides the symptom has not fixed
  anything. Three failed fixes point at the design, not your guesswork.
  `references/root-cause.md`
- **Verify** before claiming. Run the command in this turn and read its
  output; the claim comes after that, never before. How sure you feel is not
  something anyone else can check. `references/verify.md`
- **Review** before merge. Dispatch a reviewer with fresh context and put the
  diff on disk for it to read, so those bytes fill their context instead of
  yours. `references/review.md`
- **Finish** deliberately. Green suite first, then let your partner pick
  merge, PR, or leave it. Never pick for them. `references/finish.md`
- **Meter the run** as you hand it back. `scripts/run-stats.sh` reads the
  ledger out of the session transcript: elapsed, tools, tokens, and what each
  dispatched agent cost. A summary you assemble from memory is the one that
  flatters you. `references/meter.md`

## Changing channel

Escalate out loud. A `fast` task that turns out to need a new interface becomes
`main`, and you say so. Finishing quietly in the wrong channel is the failure
this prevents; the same goes for dropping to a shallower one. Explicit
instruction wins: "just do it" collapses to `fast`.

## Deep channel

Design to `docs/specs/YYYY-MM-DD-<topic>.md`, plan to
`docs/plans/YYYY-MM-DD-<topic>.md`, unless the repo has a convention or
your partner states a preference. Get the design signed off before code.

The plan needs sign-off as well whenever agents will execute it, because each
one sees only its own task and so nobody ever reads the plan whole. Executing
it yourself makes it a worklist instead: write it and carry on.

Order the plan so the tasks that change nothing come first, and mark the one
task that turns the new behaviour on. Then a late re-baseline, re-blessed
snapshots, regenerated fixtures, attributes to that one point instead of to
the branch at large.

Before Task 1, stop once and ask which flagged tasks get a reviewer and
whether the work runs in a worktree. Ask it as a choice with the counts in
it, never as a paragraph. Review that turns out to be missing is only
actionable while the plan can still change.

Read the plan as a graph rather than a list. `Needs` and `Offers` are
dependency edges and `Touches` says what cannot overlap, so which tasks may
run at once is derivable rather than guessed. Fan out wherever that graph
allows; serial is the fallback for where it doesn't, not the default.

Then read `references/deep-channel.md` for the plan format, that checkpoint,
the dispatch rules, and when a task actually needs a reviewer. Three that
catch people out: concurrent implementers need a worktree each and the flip
runs alone, review is tiered rather than automatic, and a `deep` run that
cannot dispatch has to replace the review tier with something, not quietly
ship without one.

## Conflicts

Sluice cannot run alongside the superpowers plugin. Superpowers requires its
own fixed pipeline up front for anything that adds to or changes what the
software does, not just code edits, and that pipeline overrides this router
outright, so the two cannot be installed together.
