# Review

Review fires in `main` and `deep`, before merge: the shape signals that
routed work there are what earn it a reviewer.

Hand the reviewer a file, never a pasted diff: `git diff <base> <head> >
<file>`, then give the path, not your session history. Use the actual
base commit: step back one commit from HEAD and several commits
collapse into just the last one. Tell them what was built and what it
should do.

Leave every finding open to the reviewer; steering them away from an
issue first is the same mistake as reviewing it yourself. A finding that
looks wrong still gets raised, then argued.

Findings are graded Critical, Important, or Minor, but only two things
happen next: fix now, or record for later. Fix Critical and Important
before proceeding; record Minor for the final review. Skip a third
disposition, like a separate adjudication step; it costs more than what
it sorts.

Send findings back to the agent that wrote the code: it already holds
the task and its reasoning, memory you'd rebuild otherwise. Cap this at
three rounds; one still open after is structural: stop and report it.

Receiving a finding: check it against the codebase before acting, and
argue back with specifics when it is wrong. Agreeing just to move things
along doesn't count as engaging with it.

For a small fix, read the diff and confirm the covering test ran;
re-review only for substantial logic changes. Never fix findings
yourself while coordinating: a controller fix skips review and burns
context the plan needs.

The friction line: "dispatching a reviewer for this is overkill."
Skipping the dispatch doesn't skip the cost, it just moves the cost onto
you, and self-review is not review.
