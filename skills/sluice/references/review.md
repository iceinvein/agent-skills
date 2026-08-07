# Review

Review fires in `main` and `deep`, before merge and after any change big
enough to earn them.

Hand the reviewer a file, never a pasted diff: `git diff <base> <head> >
<file>`, then give the path; it belongs in their context, not yours. Use
the real base commit, never `HEAD~1`, which drops every commit but the
last on a multi-commit change. Tell them what was built, what it should
do, and the diff path, not your session history.

Do not pre-judge: never tell a reviewer not to flag something. A finding
that looks wrong still gets raised, then argue it.

Findings get graded Critical, Important, or Minor, but disposition is
binary: fix now, or record and move on. Fix Critical and Important before
proceeding; record Minor for the final review. Grading a third bucket
costs more than the findings it would sort.

Send findings back to the agent that wrote the code: its context is
intact, yours may not be. Cap this at three rounds; one still open after
that is structural, not a review problem: stop and report it.

Receiving a finding: verify it against the codebase before acting, and
push back with technical reasoning when it is wrong. No performative
agreement.

For a small fix, read the fix diff and confirm the covering test ran;
re-review only when the fix changed logic substantially. Never fix
findings yourself when coordinating: a controller fix skips review and
burns context the plan needs.

The friction line: "I will just read the diff myself." That burns context
you need to keep coordinating, and self-review is not review.
