# Root cause

This rule is trigger-based, not channel-assigned. A crash, a test that just
turned red, output nobody can account for: anything the code does that
nobody intended fires it, in every channel, `bypass` included.

It rules out patching first and understanding later. A change aimed at the
symptom buys quiet, and the quiet ends: the defect comes back, usually
worse.

**Reproduce it first of all.** A fault you cannot trigger on demand
is not something you can fix, only guess at. Then read the error to the end,
stack trace and all; the part you skim is often the part naming the cause.

**Find the origin, not the blast site.** Follow the bad value back to
whatever produced it and repair it there. Two things shorten the walk: what
moved recently, a commit or a dependency bump, and a nearby case that works.
Set the working one beside the broken one and list every way they diverge,
the ways you are sure do not matter included, since that is usually where it
hides.

**One hypothesis, written down.** Alter two things at once and a green
result cannot say which earned it, so state the theory plainly, pick the
smallest change that would confirm or kill it, and change exactly that.

**The fix travels with a test that would have caught it.** Write it, see it
fail, make the single change your hypothesis called for, then run it again.
With the cause dead, put validation on the layers that let the bad value
pass, so its next variant trips something loud instead of slipping by.

Three failed fixes point at the design, not your guesswork. Stop and raise
it rather than trying a fourth.

A test that waits by sleeping a fixed duration will flake eventually. Poll
for the condition it is really waiting on and fail on a timeout.

The friction line: "I have seen this exact error before, I know the fix."
Recognising the pattern skips the step where you check it still applies here.
