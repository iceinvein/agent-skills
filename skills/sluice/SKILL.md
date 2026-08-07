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
`deep` stops, for design sign-off before code.

Name the channel and the signal that actually routed you there. The strings above
are examples, not fixed copy, and a channel with a two-part signal should say
which part applied. `bypass` says nothing at all, because a question that gets
announced stops being a question.

**`root-cause` and `finish` are not channel-assigned.** A bug, test failure, or
unexpected behaviour triggers the first, in every channel including `bypass`.
An integration event, merging, pushing, or opening a PR, triggers the second.

## The rules

One line each. Read the reference only on friction: the moment you notice
yourself wanting to skip the rule, or arguing that this case is different.

- **Agree intent** before building. One question at a time. Propose approaches
  with a recommendation, not a survey. `main` agrees in a message, `deep` writes
  it down. `references/intent.md`
- **Test first.** Write the failing test, watch it fail, then the minimal code.
  Skip the watching and a passing test is just an unchecked guess.
  `references/test-first.md`
- **Root cause** before fix. A fix that only hides the symptom has not fixed
  anything. Three failed fixes points at the design, not your guesswork.
  `references/root-cause.md`
- **Verify** before claiming. Run the command in this turn, read the output,
  then make the claim. How sure you feel is not something anyone else can
  check. `references/verify.md`
- **Review** before merge. Dispatch a reviewer with fresh context and hand it the
  diff as a file, so it lands in their context and not yours.
  `references/review.md`
- **Finish** deliberately. Green suite first, then let your partner pick
  merge, PR, or leave it. Never pick for them. `references/finish.md`

## Changing channel

Escalate out loud. A `fast` task that turns out to need a new interface becomes
`main`, and you say so. Finishing quietly in the wrong channel is the failure
this prevents; the same goes for dropping to a shallower one. Explicit
instruction wins: "just do it" collapses to `fast`.

## Deep channel

Design to `docs/specs/YYYY-MM-DD-<topic>.md`, plan to
`docs/plans/YYYY-MM-DD-<topic>.md`, unless the repo has a convention or
your partner states a preference. Get the design signed off before code.

Then read `references/deep-channel.md` for the plan format, the dispatch rules,
and when a task actually needs a reviewer. Two that catch people out: never run
two implementers at once, and review is tiered, not automatic.

## Conflicts

Sluice cannot run alongside the superpowers plugin: superpowers mandates its
own pipeline before any creative work, and that pipeline overrides this
router entirely. The two cannot be installed together.
