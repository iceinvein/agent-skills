# Design: verification gates per channel

Signed off 2026-10-14 through plan mode. The plan is `docs/plans/2026-10-14-verification-gates.md`.
## Context

Agreed earlier: verification is a gate on each existing channel, not a fifth
channel; bug-hunter fires in `main` only when the agreed intent has a checkable
claim. Agreed just now: a bug bug-hunter proves is fixed in-run, test-first.

Today `fast`'s check is a prose rule ("run it, read it"), and `main`/`deep`
add only opinion: review. Nothing proves the change against what was agreed.
The freshness harness (built, baselined) measures each gate once it lands.

| Channel | Gate after this run |
|---|---|
| `bypass` | none |
| `fast` | a passing check recorded against the tree as it stands; the Stop hook refuses a handback whose tree moved since |
| `main` | the fast gate, then bug-hunter on the diff when the agreed intent has a checkable claim, then review |
| `deep` | per-task as today; after the flip lands, bug-hunter on the whole plan diff against the spec, before the final review |

## Decisions

- **D1 `status.sh verify -- <cmd...>`.** Runs the check, passes its output and
  exit code through, and on exit 0 writes the tree's content digest to
  `.sluice/verified`: `git write-tree` over a temporary copy of the index
  after `git add -A`, from `scripts/content-digest.sh`, the same script the
  hook runs. It hashes untracked files' contents and leaves out ignored ones,
  and committing the same content does not change it. (Amended at the flip's
  review: the first digest, `tree-snapshot.sh`, missed edits to new files and
  read a commit after the check as a change.) `.sluice/` already ignores
  itself, so the record never moves the tree it describes. `status.sh verify
  --none "<reason>"` records the digest for a change no check can cover (docs,
  config), with the reason in the transcript where the partner can read it
  (run-stats does not parse it; that stays out of this run, as below).
  Explicit, rather than guessing from the transcript which Bash command was "a
  test": that list would be a hardcoded heuristic per ecosystem.
- **D2 Stop hook gate, `fast` and `main`.** In a session whose last route is
  `fast` or `main` and whose tree moved since the session opened (the existing
  entry stamp), a stop is refused when `.sluice/verified` is missing or its
  content digest differs from the tree now. The reason names `status.sh verify -- <cmd>`
  and `--none`. One refusal per turn (`stop_hook_active`), as the run guard
  does. `deep` is left to its run guard and `finish`'s full-suite run, so one
  turn never carries two refusals.
- **D3 `main` hunt.** After the code is green and before review: if the intent
  agreed in the message states a checkable claim (a limit, a boundary, an
  invariant, a stated result), invoke bug-hunter on the working diff with that
  message as its request source. Otherwise say in one line that there was no
  checkable claim and skip it. Proven bugs: each repro becomes the red test,
  the fix follows test-first, and the repro is re-run (not the whole hunt).
  Ambiguities go to the partner at the handback. The reviewer's brief carries
  the hunt's report path. Merge only with no proven bug open.
- **D4 `deep` hunt.** Once every task is `done` and before the final review:
  bug-hunter on `<base>..HEAD` against `docs/specs/<topic>.md`. Each proven bug
  becomes one fix, test-first, recorded in the run record under a `## Hunt`
  section; the final review reads that section and the report. No new run.json
  fields: the hunt is the controller's work, like the final review. (Amended at
  Task 5's review: each fix does take a task row, dispatched and reviewed at
  its tier, since a finding is not the controller's to fix.) In `main` and
  `fast` the recorded check comes last, after the hunt and any fix, because
  the hunt's own `.bug-hunter/` output moves the content digest.
- **D5 Bug-hunter unavailable** (not installed, or no Skill tool): said once in
  the announcement and again at the merge, as `references/review.md` does for a
  missing reviewer. The gate is never silently skipped.
- **D6 Where it is written.** One line per gate in SKILL.md's rules; the detail
  in `references/verify.md` (D1, D2), `references/review.md` (D3, D5),
  `references/deep-channel.md` (D4), with `finish.md` naming open proven bugs
  as a stop before the three options. Bug-hunter itself is unchanged.
- **D7 Measured, not assumed.** New eval cases, each pinned in `rules.json`:
  `fast-verifies-before-handback` (a `status.sh verify --` call after the last
  edit), `main-hunts-a-checkable-claim` (bug-hunter fires after the source
  edits and before the handback; the planted bug is fixed with a test),
  `main-skips-the-hunt-without-a-claim` (no bug-hunter call, one-line skip),
  `deep-run-hunts-after-the-flip` (bug-hunter after the flip, before
  `status.sh final`). Hook behaviour is pinned in `bun test`, not evals.
- **D8 Version.** sluice 0.24.0 (a new command and new behaviour).

## Not in this run

Hook enforcement of the hunts (whether a claim is checkable is judgement, so
evals pin it, not a hook); changes to bug-hunter; a gate on `bypass`; run-stats
reporting gate status; re-baselining sluice (your call after the run).

## Verification (for the implementation run)

- `bun test`: `status.sh verify` (records on 0, not on non-zero, `--none`
  needs a reason) and the Stop hook (refuses an unverified moved tree in fast
  and main, passes a verified one, refuses again after a later edit, ignores
  deep and bypass, refuses once per turn), with hand-written expectations.
- The four new eval cases run once each with `--keep-temp`, graders read
  against the kept traces, as for the grader tightening.
- A full `eval:fresh run skills/sluice` afterwards shows whether the gates cost
  the existing cases anything; accepting it is your call.
