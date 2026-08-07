---
name: sluice
description: Use at the start of any request that changes code. Routes the work into one of four channels (bypass, fast, main, deep) by change shape, and applies only the rules that channel needs. Also use when asked to work faster or with less process.
---

# Sluice

A sluice sorts material by size into channels and meters what flows through.
Same here: pick the channel the change needs, pay for nothing else.

## Route first

Pick a channel from the change's shape, state it in one line, then proceed. The
announcement is how your human partner redirects you without being asked.

| Channel | Signal | Rules | Say |
|---------|--------|-------|-----|
| `bypass` | No code change: a question, an explanation, a read | none | nothing, just answer |
| `fast` | Existing interfaces, one subsystem | test-first, verify | "Fast channel. Test first, then implement." |
| `main` | Adds an interface, or crosses subsystems | + agree intent, review before merge | "Main channel, new interface. Agreeing the shape first." |
| `deep` | Several subsystems, or a plan was asked for | + written design and plan | "Deep channel, several subsystems. Design before code." |

Name the channel and the signal that actually routed you there. The strings above
are examples, not fixed copy, and a channel with a two-part signal should say
which part applied. `bypass` says nothing at all, because a question that gets
announced stops being a question.

**`root-cause` is not channel-assigned.** Any bug, test failure, or unexpected
behaviour triggers it, in every channel including `bypass`.

## The rules

One line each. Read the reference only on friction: the moment you notice
yourself wanting to skip the rule, or arguing that this case is different.

- **Agree intent** before building. One question at a time. Propose approaches
  with a recommendation, not a survey. `main` agrees in a message, `deep` writes
  it down. `references/intent.md`
- **Test first.** Write the failing test, watch it fail, then the minimal code.
  If you did not watch it fail you do not know what it tests.
  `references/test-first.md`
- **Root cause** before fix. Symptom fixes are failure. Three failed fixes means
  the architecture is wrong, not your hypothesis. `references/root-cause.md`
- **Verify** before claiming. Run the command in this turn, read the output,
  then make the claim. Confidence is not evidence. `references/verify.md`
- **Review** before merge. Dispatch a reviewer with fresh context and hand it the
  diff as a file, so it lands in their context and not yours.
  `references/review.md`
- **Finish** deliberately. Green suite first, then let your human partner pick
  merge, PR, or leave it. Never pick for them. `references/finish.md`

## Changing channel

Escalate out loud. A `fast` task that turns out to need a new interface becomes
`main`, and you say so. Finishing quietly in the wrong channel is the failure
this prevents; the same goes for dropping to a shallower one. Explicit
instruction wins: "just do it" collapses to `fast`.

## Deep channel

Design to `docs/specs/YYYY-MM-DD-<topic>.md`, plan to
`docs/plans/YYYY-MM-DD-<topic>.md`, unless the repo has a convention or your
human partner states a preference. Get the design signed off before code.

Then read `references/deep-channel.md` for the plan format, the dispatch rules,
and when a task actually needs a reviewer. Two that catch people out: never run
two implementers at once, and review is tiered, not automatic.
