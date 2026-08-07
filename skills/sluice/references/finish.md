# Finish

Run the project's full suite before anything else. A red suite stops here;
there is no menu after a failure. A green run from earlier in the session
does not count, because it only proves the tree it ran on then.

Confirm the base branch instead of assuming it. Merging into the wrong base
is expensive to undo.

With a green suite and a confirmed base, present exactly three options and
wait: merge locally, push and open a PR, or leave the branch as it is. The
integration decision belongs to your human partner, not you, however
obvious the answer looks from where you sit.

After a local merge, re-run the suite on the merged result before deleting
anything. A failure there stops the cleanup, and since nothing has been
pushed yet, it is still recoverable.

Once a PR is open, keep the workspace; that is where review feedback gets
addressed. Discarding work needs an explicit ask from your human partner,
confirmed before anything is deleted. Clean up only the workspaces the
tooling created, not anything belonging to the host environment.

The friction line: "they obviously want this merged." Obvious to you is
not consent from them. Wait for the answer.
