# Agree intent

Ask one question at a time. Use multiple choice when the answer set is
bounded.

Offer two or three approaches, never a survey. Lead with the one you
recommend and say why. Cut every feature YAGNI would cut before you present
any of them; a lean option judged against a padded one is not a fair
comparison.

Check decomposition before design starts. If the request is really several
independent subsystems, say so first. Split it into pieces that ship on
their own, agree the order, and carry only the first through the channel.
Each piece earns its own design and plan. One design covering four
subsystems produces a plan wrong in four places, found only once tasks are
dispatched against it.

Scale with channel. `main` agrees in one message and writes nothing. `deep`
writes the design and gets sign-off before code. `fast` and `bypass` never
reach this rule.

When a question would land better shown than described, `references/visual.md`
covers how. Do not restate it here.

The rationalization: "I already know what they want." You know the goal,
not the constraints, and the shape in your head rarely matches theirs. One
question costs a turn. A wrong build costs the task.
