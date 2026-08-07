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

Once the suite is green and the base is confirmed, lay out the choice and
wait: merge it locally, push it and open a PR, or leave it as is.
Whether to merge, PR, or wait is your partner's call, not yours, however
obvious it looks to you.

After a local merge, re-run the suite on the merged result before
deleting anything. A failure there stops the cleanup; you haven't pushed
anything yet, so you can still walk it back.

Once a PR is open, keep the workspace; that's where review feedback gets
addressed. Discarding needs an explicit, confirmed ask from your partner.
This tooling removes only the workspaces it created; anything else
stays put.

The friction line: "picking for them saves everyone a turn." Saving a
turn is not the same as having their answer. Wait for it.
