# Finish

`finish` fires at an integration event, merging, pushing, or opening a PR,
in every channel. A commit made in passing during `fast` channel work is
not one of those: the branch as a whole has to be about to leave your
hands.

In `deep`, the final review comes before this file starts, and its verdict is
in hand or it is not: `references/deep-channel.md` owns it. Nothing here
dispatches a review; this is where what the reviews found gets said.

Start here: run every test the project has, not a sample of them. A red
result stops the process; there is no menu after a failure. A pass from
earlier in the session doesn't count: the tree has changed since, and
only a run against what's here now proves anything.

Confirm the base branch instead of assuming it; untangling a wrong merge
costs far more than asking would have.

With the suite green and the base confirmed, put exactly three options to
your partner, with the run ledger above them so the choice is made against
what the work actually cost rather than against your account of it;
`references/meter.md` owns that. Say in one clause whether the work was
reviewed. Merging reviewed work and merging unreviewed work are different
decisions, and the ledger does not tell them apart: it counts the agents you
dispatched, not whether any of them read this diff. The three: merge it locally, push it and
open a PR, or leave the branch as it stands. Those three exhaust what you may offer. Your partner may still
ask for something off the list, most notably scrapping the branch, but the
request has to originate with them and be unmistakable. Then stop. Which of
the three it is belongs to them, however obvious the choice looks from where
you are standing, so nothing moves until they say.

After a local merge, run the whole suite again over the merged tree before
deleting anything. A failure there stops the cleanup; you haven't pushed
anything yet, so you can still walk it back.

## The handback message

The parts are owned by three references and read as one message, so this is
the one list of them. In order:

1. The suite's result, as it printed, with the command that produced it.
2. The ledger, `scripts/run-stats.sh --tests "<that result>"`, pasted
   unedited. `references/meter.md`
3. In `deep`, `status.sh show`, pasted, so "four of nine, task five blocked,
   two done at tier 1+ with no dispatch, final review pending" is on the page
   rather than in your account of it. `references/status.md`
4. One clause on review: dispatched and clear, dispatched with findings still
   open, or not dispatched and why. In `deep` that clause covers the per-task
   tiers and the final review separately, because the count carries one and not
   the other. Where pre-flight priced the level, say what was covered and how,
   not that review is outstanding: "reviewed at the level you chose, a
   controller stat read plus the final whole-plan pass rather than a per-task
   dispatch" is the accurate line, and it is a coverage level rather than a
   debt. Where nothing was priced, it is a debt and says so.
5. The three options, and nothing after them.

A `deep` run closes when the work stops being yours to act on: after a local
merge and its re-run of the suite, or when your partner leaves the branch where
it stands. While a PR is open it stays live, because the review comments come
back as work on those same tasks and the rows are where that work is tracked;
it closes when the PR lands. `status.sh close` archives the state and prints
one line saying what it archived, and that line goes in your reply. A run left
open blocks the next `init` and renders a finished plan in the statusline as a
live one, which is how a run comes to sit at 0/9 for three weeks.

While a PR is open, the workspace survives: it is where the review
comments get answered, and tearing it down means rebuilding it the moment
the first one arrives. Discarding needs an explicit, confirmed ask from
your partner. This tooling removes only the workspaces it created;
anything else stays put.

The friction line: "picking for them saves everyone a turn." Saving a
turn is not the same as having their answer. Wait for it.
