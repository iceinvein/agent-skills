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

Name the claim the review has to settle as well. A diff and an intent with no
question attached buys a general opinion, which is the most expensive kind of
finding to receive and the least actionable one.

Leave every finding open to the reviewer; steering them away from an issue
first is the same mistake as reviewing it yourself. A finding that looks
wrong still gets raised, then argued.

Every finding has one of two destinations. Either it goes back to the agent
that wrote the code and the work stays where it is until the fix lands, or it
is written down against the task and waits. In `deep` that is the run record
`references/deep-channel.md` sets up, and it is what the final review reads. In
`main` there is no plan and no record, so a finding that waits waits in the
message you hand back, named there rather than carried silently to the merge.
Reviewers grade findings Critical, Important or Minor, and the grade picks
between the two: only Minor may wait, and anything above it blocks.

The grade is the sort, and it has to be load-bearing. The alternative is you
reading every finding to decide where it goes, which is an adjudication pass
that costs more than the findings are worth and puts the coordinator back
inside the diff it dispatched to stay out of. A third destination is not on
offer, so neither is that pass.

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

## When you cannot dispatch

Separate the two cases before you say anything. A session that grants subagents
only on request has not withheld them: asking is the whole procedure, and a
claim that you cannot dispatch is false there. A session that withholds them
outright is the one this section is about. The review is owed either way.
`deep` has its own treatment in `references/deep-channel.md`, where there is a
plan to shrink and a tier table to argue from; this is the `main` case, which
has neither.

Say it twice, and only twice.

The first time is the routing announcement, in the same breath as the channel.
Withheld: "Main channel, new interface. I cannot dispatch a reviewer in this
session, so this merges unreviewed unless you want one." On request: "Main
channel, new interface. A reviewer is one dispatch away if you want one, and
without it this merges unreviewed." Either way, that is the moment it is still
a decision. Your partner can authorise the dispatch, split the change, or
accept the gap knowingly. The same words at the end are a disclaimer.

The second is the integration event, where `references/finish.md` puts the
three options. Review status belongs beside them, because it is part of what
merging would be agreeing to.

Between those two points, stay quiet. An obligation restated on every handback
stops being information and turns into throat-clearing, and it buries the one
mention that mattered. Nothing changed between the announcement and the merge.
If something did, that is a new fact and earns a new sentence.

The friction line: "dispatching a reviewer for this is overkill." Skipping
the dispatch doesn't skip the cost, it just moves the cost onto you, and
self-review is not review.
