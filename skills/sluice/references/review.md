# Review

`main` and `deep` both take a review before anything merges. What routed the
work there, a new interface or a second subsystem, is what makes one reader
insufficient.

Write the diff out and send the path: `git diff <base> <head> > <file>`. A
pasted diff fills your context; a file fills the reviewer's, which is what
you dispatched one for. Get the base right: `HEAD~1` is the standing
mistake, showing the last of five commits and burying the rest. Send what
you built and what it is meant to do alongside the path, and nothing about
how you got there.

Leave every finding open to the reviewer; steering them away from an issue
first is the same mistake as reviewing it yourself. A finding that looks
wrong still gets raised, then argued.

Grades come back as Critical, Important or Minor, but a finding has only two
places to go: fixed before the work moves on, which is what the top two
amount to, or on the record for the final review, which is what Minor
amounts to. Do not add a third slot, or an adjudication step to feed it; the
sorting costs more than the findings are worth.

Send findings back to the agent that wrote the code: it already holds the
task and its reasoning, memory you would otherwise rebuild. Three rounds is
the cap, and a finding still open when the third one ends is structural, not
local, so stop there and hand it to your partner.

Receiving a finding: check it against the codebase before acting, and argue
back with specifics when it is wrong. Agreeing just to move things along is
not engagement.

For a small fix, read the diff and confirm the covering test ran; re-review
only for substantial logic changes. While you are the one coordinating,
findings are not yours to fix: your patch would be the single patch nobody
reviews, and it spends context the plan still needs.

The friction line: "dispatching a reviewer for this is overkill." Skipping
the dispatch doesn't skip the cost, it just moves the cost onto you, and
self-review is not review.
