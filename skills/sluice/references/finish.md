# Finish

`finish` fires at an integration event, merging, pushing, or opening a PR,
in every channel. A commit made in passing during `fast` channel work is
not one of those: the branch as a whole has to be about to leave your
hands.

Start here: run every test the project has, not a sample of them. A red
result stops the process; there is no menu after a failure. A pass from
earlier in the session doesn't count: the tree has changed since, and
only a run against what's here now proves anything.

Confirm the base branch instead of assuming it; untangling a wrong merge
costs far more than asking would have.

With the suite green and the base confirmed, put exactly three options to
your partner: merge it locally, push it and open a PR, or leave the branch
as it stands. That list is closed. Anything outside it, throwing the work
away included, happens only when they ask for it in as many words. Then
stop. Which of the three it is belongs to them, however obvious the choice
looks from where you are standing, so nothing moves until they say.

After a local merge, run the whole suite again over the merged tree before
deleting anything. A failure there stops the cleanup; you haven't pushed
anything yet, so you can still walk it back.

While a PR is open, the workspace survives: it is where the review
comments get answered, and tearing it down means rebuilding it the moment
the first one arrives. Discarding needs an explicit, confirmed ask from
your partner. This tooling removes only the workspaces it created;
anything else stays put.

The friction line: "picking for them saves everyone a turn." Saving a
turn is not the same as having their answer. Wait for it.
