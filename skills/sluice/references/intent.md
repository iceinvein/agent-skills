# Agree intent

Ask one question at a time. Use multiple choice when the answer set is
bounded.

Offer two or three approaches, never a survey. Put your top pick first
and explain what makes it the better bet. Cut every feature YAGNI would
cut before you present any of them; a lean option judged against a
padded one is not a fair comparison.

Size the request before you start refining it. "A CLI, a web dashboard and a
sync daemon" is three projects wearing one sentence, and every question you
spend on the details of any one of them is spent too early. Say so the moment
you notice, cut the work at its seams into pieces that could each ship alone,
agree the order they go in, and take only the first into the channel. The
rest wait their turn, each with a design and a plan of its own. One design
covering four subsystems produces a plan wrong in four places, found only
once tasks are dispatched against it.

Scale with channel. `main` agrees in one message and writes nothing. `deep`
writes the design and gets sign-off before code. `fast` and `bypass` never
reach this rule.

When a question would land better shown than described,
`references/show-or-say.md` covers how. Do not restate it here.

The friction line: "I already know what they want." You know the goal,
not the constraints, and the shape in your head rarely matches theirs. One
question costs a turn. A wrong build costs the task.
