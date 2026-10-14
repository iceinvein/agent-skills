# Verify

Claiming that something works has a fixed sequence in front of it: pick the
command that proves the claim rather than the one that would make it feel
true, run that command in full during this turn, read its output and its exit
code, and write the sentence only once you have. What you remember from an
earlier run is no substitute for reading this one, however convincing it was
at the time.

| Evidence in hand | What it lets you say |
|---|---|
| the original symptom, retested and gone | "bug fixed" |
| the actual diff, not its own status report | "subagent finished" |
| a fresh full run, zero failures, exit code checked | "tests pass" |
| a real build command at exit 0, not a clean linter | "build succeeds" |

A regression test counts only once you have seen it go both ways: red with
the fix backed out, green with the fix back in. A test that has only ever
passed proves nothing about what it would catch.

Wording is not a loophole. "Looks right", "should be good" and "that's
sorted" are completion claims in other clothes. So is pleasure at your own
work: "beautiful", "there we go", "nailed it" each announce that the thing
landed, and each needs the same command run beforehand as "it passes" does.

## The recorded check

Reading the output is something only you can see happened. So in `fast` and
`main` the check goes through the recorder: `status.sh verify -- <cmd>` runs
the command from the tree's top level, passes its output and exit code through
untouched, and on exit 0 writes the tree's content digest to `.sluice/verified`.
A failing check records nothing and exits with its own code, so it reads as the
failure it is. Run it after the last edit: the digest is of the content, what
`git add -A` would stage, so an edit made after the tests went green moves it,
in a tracked file or a new one, while committing the checked content does not.

`status.sh verify --none "<reason>"` records the same digest with no command,
for a change no check can cover: docs, a config value nothing reads in a test,
a comment. It is honest when there is no command whose result would differ
with and without the change. It is not honest for a check that exists and is
slow, flaky or red: that is a result to report, not a reason to skip one. The
reason prints in the transcript, where your partner reads it.

The Stop hook holds you to it. In a session whose last route was `fast` or
`main` and whose tree has moved since the session opened, a stop is refused
when the record is missing or names content the tree no longer holds, and the
refusal names both commands. It refuses once per turn, as the run guard does:
a turn that cannot check, and says why, is let through on the next attempt, so
it is a nudge carrying the remedy, not a wall. `deep` is left to its run guard
and to the full suite `references/finish.md` runs, so one turn never carries
two refusals, and `bypass` never routes, so it never reaches the gate.

The digest has three limits worth knowing:

- One untracked file git cannot read makes the digest unknown, and unknown lets
  the stop through, so the gate is off for that tree until the file is
  readable. `verify` prints git's error when this happens, so you see why it
  recorded nothing.
- Each digest writes loose git objects for the changed content. Nothing
  reaches them, so `git gc` prunes them once they pass its expiry.
- Edits inside a nested repository are invisible to it, as they are to the
  entry check.

## Friction

The friction line: "the change was too small to need a full run." Run it.
