# Run record: magpie local mode

Plan: `docs/plans/2026-10-18-magpie-local-mode.md`. Spec:
`docs/specs/2026-10-18-magpie-local-mode.md`. State: `.sluice/run.json`.

## Pre-flight (2026-10-18)

- **Review: all 7 tasks get a reviewer.** Chosen over flip-only. T6 rewrites the agent
  prompts and SKILL.md, which no test covers, and T1 to T4 are what later tasks build on
  blind.
- **Effort: T1 and T4 low, the rest at session effort.** Both have exact contracts and
  spelled-out commands. Their reviews run at session effort.
- **Workspace: one worktree, implementers serial, each agent commits its own task.** The
  graph allows only two small overlaps (T1/T2, T3/T4), which did not justify per-task
  worktrees. The worktree was cut by hand from local `master` (31 commits ahead of
  `origin/master`, including magpie 0.13.2) at `.claude/worktrees/magpie-local-mode` on
  branch `magpie-local-mode`, then entered by path. The harness default would have
  branched from `origin/master` and missed that work.

## Notes

- Typecheck gate: `bun run typecheck` fails before any change (`tsc: command not found`;
  no package depends on typescript). The gate is `bunx -p typescript@5.9.3 tsc --noEmit`,
  which passes on the baseline and writes nothing to the tree. Plan Ground Rules updated.
- Baseline at `master` 427bded: 648 tests pass, lint clean.

## T1 review, round 1 (on 2a2ef61)

Sent back to the T1 implementer: user git config (`diff.noprefix`, `mnemonicPrefix`,
`diff.external`, textconv) changed the diff format so downstream parsers saw nothing
(blocking); porcelain git wrote `.git/index` under `index.lock`; non-ASCII paths were
quoted and silently dropped; stdout/stderr read serially; meta logged `..HEAD` instead
of the reviewed `head`; `repoPath` not checked to be the repo root.

Accepted without a fix: one spawn per untracked file (slow on a large unignored tree, but
correct); an untracked nested repo is left out of the diff; paths containing `"`, a tab
or a newline are still quoted by git and dropped by the parsers.

Pre-existing, not this plan's: `FILE_HEADER` in `diff-chunks.ts:3` (lazy regex) mis-splits
a path containing ` b/`, and the GitHub diff path likely has the same quoted non-ASCII path
exposure. Both predate local mode; worth a separate fix.

## T2 review, round 1 (on 3a10345)

Nothing blocking. Sent back: reject a relative or empty `root`; pin ENOENT-only fallback;
dedupe in local mode fails loudly when the root is missing instead of skipping evidence
(the skip stays for archived PR runs). The prompts' hardcoded `<RUN_DIR>/worktree` is
already T6's.

Deviation: the T1 and T2 fix rounds went out together, so two implementers ran at once in
the shared tree, against the serial pre-flight answer. Their Touches are disjoint; the
risk is `index.lock` contention at commit, which fails loudly rather than corrupting.
It cost one thing: T1's implementer saw 28 failures in a full `bun test` from T2's
half-applied edits. Re-run at a5d1175: 677 pass, lint and tsc clean. Serial from here.

T2 round 2 (a5d1175) cleared; done. Two nits accepted: a malformed `target.json` gives
dedupe a stack trace where critic-prompt prints one line, and the missing-root test
asserts `not.toBe(0)` rather than `toBe(1)`.

## T1 review, round 2 (on 7271416)

Resolved: diff format, non-ASCII paths, stream reads, log range, repo-root check. Still
open (blocking): the tracked `git diff <mergeBase>` refreshes and writes `.git/index`
under `index.lock` even with `GIT_OPTIONAL_LOCKS=0` (git 2.56), whenever the index is at
least a second old. The round-1 test missed it because a freshly built test repo's index
is same-second. Round 3 fix: run the tracked diff with `GIT_INDEX_FILE` pointing at a temp
copy of the index (chosen over `git diff-index -p`, whose output for stat-dirty but
content-identical files would need checking), and age the index with `utimes` in the
test so it fails on the current code.

The implementer could not reproduce the write (49fafd6: aged-index test only, no fix) and
stopped rather than ship an untested fix, which was the right call. The controller
settled it with `scratchpad/idxprobe.ts`: the write happens only when a tracked file is
stat-dirty with identical content (mtime moved, bytes not: a no-op save, a checkout, a
touch). The implementer's probe had a content change, so it never hit the case. Repro
sent back.

Round 3 (4e04e91): cleared; T1 done. The tracked diff runs against a temp index copy via
`GIT_INDEX_FILE`; the reviewer also checked `core.splitIndex`. One nit accepted at the
review cap: with no index file at all, `GIT_INDEX_FILE` stays unset and git may create
`.git/index` in the caller's repo (rare: a repo with commits and a deleted index).

T4 done at 0bdc747 (test-only follow-up matching the review).

## T3 review, round 1 (on 51006d1)

Nothing blocking. Sent back: tests for failed recompute and missing `diffSha256` reading
as stale; a spawn throw during recompute is treated as stale with the error on stderr
(the findings still reach the agent); the suggestion fence grows past any backtick run
in the body; zero-findings asserted exactly; an `optional` fixture.

Format addition beyond the spec, decided here: a `Suggested replacement for lines a-b:`
label above each suggestion block, because the anchor line alone leaves the agent guessing
how many lines the replacement covers.

Accepted: ranking can put a high-scoring should-fix above a must-fix (spec says
`rankActionable` order; every item carries its action tag). A mistyped run dir reports as
a PR run, from T2's missing-`target.json` default.

Round 2 (b817df4): cleared; T3 done. Nit accepted: an `{ok: false}` recompute reads as
stale without echoing its error to stderr (a throw does echo).

Carried to T5: setup must record `diffSha256` of the raw `localBranchDiff` output, before
`applyPathFilter`, or every filtered run's handoff reads as stale.

## T4

Touches widened to `scripts/__tests__/skill-lint.test.ts`: its shard-gate test asserts
the diagnostic stage is outside `ORDER`, and a local run hits the same gate, so it now
checks `LOCAL_ORDER` too.

Review round 1 (on 3088fc9): nothing blocking. To fix: a test with `target.json`
`mode: 'pr'` (which every PR run will have after T5), so choosing the ladder by file
existence rather than `mode` goes red; assert `lastCompleted` in the no-target test.
Carried to T7: the eval fixtures' fake `magpie status` copies `ORDER`, and
`evals/README.md` claims the fakes match `status-cmd.ts`; the new case's fake must read
`target.json` and switch ladders.


## T5 (the flip)

Built at 75a18e5. One edit outside Touches, justified: `pipeline-e2e.test.ts` gained
`mode: 'pr'` on its `runSetup` call, since the required discriminant broke tsc there
and an optional `mode` would have meant inventing a default. The cleanup test passed
before the code existed (the old PR path also left the repo intact), so the implementer
added an assertion on the archived `target.json` to make it go red first.

Review round 1 (on 75a18e5): smoke passed (setup, target, status, handoff, cleanup on a
scratch repo with committed, uncommitted, untracked and stat-only changes; status, index
bytes and worktree list byte-identical throughout). Nothing blocking on the documented
flow. Sent back: a run dir inside the repo let the rollback delete the caller's files
(reproduced); an unset `$RUN_DIR` made `--local` the run dir; `target`/`handoff` on a
mistyped dir fell back to PR mode silently (now the fallback needs `log.jsonl`); run-id
patterns in `housekeeping-cmd.ts` and `resolve-run.ts` only knew `pr-*`, so local runs
were invisible to `--list-runs`, `open`, `serve` and resume. That last one is a plan gap:
no task covered it, so T5's Touches widened to include both files. Also a worktree left
behind if PR-mode `writeTarget` throws, and a directory accepted as `--intent-file`.
Accepted: the raw-sha test computes its expected value with `localBranchDiff` (it pins
raw versus filtered, which is the point).

Round 2 (15f4384): all six resolved, but `readTarget` requiring `log.jsonl` broke
`evals/quality/replay-critic.ts` (bare scratch run dir) and made `magpie status` on a
mistyped dir crash. Round 3 (494e8dc): replay-critic writes `target.json`; status
catches and exits 2. Cleared; T5 done. Touches widened again to `replay-critic.ts`.
Untested: worktree removal when PR-mode `writeTarget` throws (no seam); CLI argument
handling (the repo has no CLI tests; verified by hand by implementer and reviewer).

## T6

Built at 9353023. `skill-lint.test.ts` caps SKILL.md at 3000 words and master already sat
at 2997, so the implementer raised the cap to 3500 (an earlier commit raised it from
2600 the same way). Treated as a budget the plan knowingly changes rather than a
loosened assertion; flagged to the user at handback. The scout placeholder assertion
now lists `<<WORKTREE>>`/`<<TARGET>>` in place of `<<PR_NUMBER>>`.

Review round 1: nothing blocking. Sent back: `$REPO` unset in local mode; handoff's
`Run:` path stale after cleanup renames the dir (line removed, agent appends the
archived path); cleanup's `view later` line suppressed for local runs (code change in
`cleanup-cmd.ts`, Touches widened); resume after stage 3 never set `WORKTREE`/`TARGET`
(a T6 regression for PR runs too); resume glob matched other branches' runs; re-run
handoff on a resume at cleanup; handoff exit-code handling; who answers the shard gate
in local mode; detached wording unified; trims. Accepted: PR wording inside prompt
bodies. Pre-existing, not this plan's: `package.json` version (0.11.0) disagrees with
`skill.json`, so `magpie --version` misreports.

Round 2 (0424e56): cleared. Three nits sent as a short last round (README's "no
`screen/`", a cleanup comment's reason, cleanup reading `target.json` before its side
effects). Deviation: that round and T7 run at once in the shared tree. Their Touches are
disjoint, and each was told to stage only its own paths.
Round 3 (688e3a0): nits fixed, T6 done. The cleanup tests' shared setup now writes an
empty `log.jsonl`, as every real run has (same adjustment as dedupe and critic in T5).

## T7

Built at 082893a, with a `rules.json` entry at bf47d2b (Touches widened). The worktree
guard refused to run `fixture.sh` (git under a redirected HOME) for the implementer and
the reviewer alike, so the scaffold's git half is verified by reading only; the fake
`magpie` status/handoff/cleanup were exercised in isolation. The case has not been run
under `claude plugin eval` (paid; whether it can filter to one case is unchecked).

Review round 1: nothing blocking; graders go red on each wrong behaviour. Sent back:
a stale `unpinned` reason on `cleanup-surfaces-the-view-later-line`; the origin commit
(9353023, where Local mode entered SKILL.md); bolded section labels in the fake handoff;
git config isolation in the scaffold; the `Run archived at` line required by the judge;
a rewrap. Open until a real eval run: Apple's xcrun `/usr/bin/git` shim in the eval
sandbox (the sluice evals README records it failing; the fixture's `TMPDIR` export fixes
the same shim for python3).

Round 2 (e6d0f62): fixes as asked; T7 done.

## Hunt

bug-hunter over `427bded..HEAD` (skills/magpie only) against the spec. Artifacts in
`.bug-hunter/2026-10-18-magpie-local-mode/` (`intent.md`, `scenarios.md`,
`findings.json`, `repros/`). No `report.md`: the subagent environment refused it, so the
report is the hunt agent's reply, summarised here. 18 scenarios passed.

- **B1, handoff omits the run dir** (spec section 4). Not a bug: the `Run:` line was
  removed on purpose in T6 round 1, since cleanup moves the dir straight after handoff.
  The spec is stale; updated.
- **B2, same-size same-second edit dropped from the diff** and **B3, handoff calls a
  changed tree fresh**: one root cause. The temp index copy (T1 round 3) gets a fresh
  mtime, which disables git's racy-entry recheck. Fix task T8: give the copy the
  original's mtime.
- **B4, failed setup with `--repo <subdir>` leaves `<repo>/run/`**: the inside-repo check
  compares against `--repo` as given, before the repo-root check. Fix task T9.
- **A1** (to the user): with `core.splitIndex`, setup bumps the mtime of
  `.git/sharedindex.<sha>`; content unchanged, no new file.
- **A2** (to the user): spec section 4 says counts and labels by severity; plan T3 and
  the code use the action (must-fix/should-fix/optional). Spec section 4 updated to
  match what shipped (action labels, no run dir, line-range label), pending the user.

T8 (e7855c0, edbce9b): the copy takes the original index's atime/mtime, stat taken
before the copy so a concurrent index rewrite can only make git recheck more. Review ran
bug-hunter's real-clock repros: B2 5/5, B3 5/5 with the fix, 0/3 each without. Checked
nsec truncation, split index, untracked cache and fsmonitor; none change the diff. Done.

T9 (3f9221d): `git rev-parse --show-toplevel` before any mkdir; guard compares against
the root. Review round 1: nothing blocking; sent back a `..`-through-symlink run dir that
slips the guard (predates T9; fix by resolving the run dir once), a missing or non-dir
`--repo` that threw from `Bun.spawn`, and two message fixes. Noted for the spec: with a
linked worktree as `--repo`, a run dir in the enclosing main checkout is allowed, since
the guard protects the tree under review.
Round 2 (2f2f6ba): run dir resolved once at the top of `runSetup` (both modes);
`--repo` stat-checked before spawning; messages fixed. Done. Untested: bare repo and
`--repo` at `.git` (only a plain non-git dir is tested).

T10: the final review found that widening `resolve-run.ts`'s patterns (T5) let `magpie
open` with no id pick the newest run, usually a local one, and render an HTML page for
it (out of scope per the spec). T10 restores PR-only resolution for `open`/`serve` and
rejects local ids and paths there; `--list-runs` keeps listing local runs for resume.
Also the resume wording that let a local run set `TARGET` to `PR #`.
Done at 980bc45, checked by the final reviewer. Nit accepted: `magpie serve <path>` skips
`resolveRunDir`, so serving a local run by hand-typed path still renders a page.

## Final review

Integration check over `427bded..HEAD`: one local run and one PR run traced end to end
through code and SKILL.md, archived pre-branch runs, accepted nits cross-checked, hunt
fixes confirmed by re-running bug-hunter's repros (B2, B3, B4 pass; B1 fails by design).
One should-fix (`open`/`serve` picking local runs) became T10. Cleared after T10. Gates at
980bc45: 727 magpie tests, 150 eval-freshness tests, lint and tsc clean.

## Handback (2026-10-18)

User decisions: keep the SKILL.md word cap at 3500; handoff labels by action, as
shipped (A2); the split-index mtime bump is acceptable and documented in the spec (A1);
leave the branch as it stands, unmerged and unpushed, to run the eval fixture and a live
local review first.
