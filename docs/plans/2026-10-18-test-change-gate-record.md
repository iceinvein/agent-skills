# Run record: test-change gate

Design `docs/specs/2026-10-18-test-change-gate.md`, plan
`docs/plans/2026-10-18-test-change-gate.md`. State in `.sluice/run.json`.

## Pre-flight

- **Review: all tiers.** A reviewer at all 7 tasks, then bug-hunter on the
  plan diff and the final review after the flip. Chosen because the gate sits
  in the hook every sluice session runs, and T1, T6 and T7 are tier 2: no stat
  confirms a classifier's edge cases or the prose.
- **Effort: T4 low, the rest at session effort.** T4's output line, source and
  fixtures are fixed by its Contract. Its review runs at session effort.
- **Workspace: one plan worktree, serial implementers, each committing its own
  task.** The graph overlaps at most three tasks (T1, T2, T4), only in the
  first wave; the session is in worktree mode, so implementers run serially.

## Notes

- The harness cut the worktree from `origin/master` (`9cafd8d`), which lacks
  today's local commits, including `89ac27e` (the test-first change this gate
  backs). Fast-forwarded the plan branch to local `master` (`ace1c2f`) before
  anything else.
- Exit codes refine design D4: `tests-changed` exits 7 when the changed tests
  pass on old code and 8 when the control run fails on old code. D4's 1 and 4
  already mean "state could not be written" and "bad arguments" in
  `status.sh`.

## Review findings

- **T1 round 1 (c455c99):** three blocking. (1) `cp` of the index without
  `-p` trips git's racy-git check, so a same-size edit right after an add is
  missed about 5 in 100 runs, and the test file flakes. (2) A new binary test
  file is flagged, though new files pass. (3) Colour, external diff and
  textconv config disable marker detection. Taken as blocking too: read
  `.sluice-test-paths` from the base, not HEAD, which the session can commit
  to. Non-blocking, taken: `-z` parsing for quoted paths. Left: a pattern line
  carrying its own pathspec magic fails silent, which is acceptable.
- **T1 round 2 (bb3e9be):** no blocking findings; T1 done. Left open: a file
  name containing a newline is detected but printed across two lines, so the
  gate would refuse two nonexistent paths (a false positive, never a miss).
  Fixing it needs a NUL-separated output contract; not taken, given how rare
  such names are. T3 and T5 consume the one-path-per-line output as is.
- **T4 (8d2eb8a):** no blocking findings; done. Left as known, all cosmetic
  and erring cautious: `--none` is matched across the whole Bash command, so
  a proved call chained with `verify --none` counts unproven; the meter counts
  commands, not calls, as `route` does; rejected calls still count, since the
  meter reads the transcript, not the record.
- **T2 round 1 (1641aa2):** one blocking, plain `cp` of the index (the T1
  race again, reproduced 5/5). Review also showed `git stash create` leaves
  untracked files out of the base, so a test file untracked at session start
  and edited by the session reads as new and passes the gate. **Design D1
  amended by the controller:** the base is now a commit built from a temporary
  index after `git add -A` (`write-tree`, `commit-tree -p HEAD`), matching the
  gate's own comparison. Same intent as signed off (pre-existing work is never
  charged to the session), different mechanism; raised at the handback. Also
  taken: scratch index under the git dir with a trap; the comment names every
  case where line 3 is absent.
- **T2 round 2 (3724d54):** no blocking findings; T2 done. Noted: session
  start now hashes untracked, non-ignored files into the object store on
  every start, resume and clear (the stop-side classifier already pays the
  same); the base commit is unreachable, so `git gc --prune=now` can delete
  it. T3's brief and T5's must treat an unresolvable line 3 as unknown.
- **T3 round 1 (5446148):** one blocking. The proof overlaid every changed
  test and accepted any failure, so a new feature's test (always red on old
  code) proved a loosened old test. **Design D4 amended by the controller:**
  the proof is a per-path differential. Control = base plus every changed
  test except the flagged ones, must pass; one proof per flagged path = that
  overlay plus the path alone, must fail; all or nothing. Deleted flagged
  tests cannot be proved red and go to `--none`. Also taken: scratch worktree
  under `$TMPDIR`, not the git dir (walking up reached the main checkout's
  `node_modules` and configs), so `--with node_modules` is needed again;
  refuse command arguments pointing into the tree; exit 8 suggests narrowing
  the command. Known limit, documented not solved: one file that loosens an
  assertion and adds a new failing test is still proved (per-file
  granularity). For T5: hash blobs path-aware (`git hash-object -- <path>`),
  as T3 records them.
- **T3 rounds 2-3 (b883f4b, 9960dca):** round 2 no blocking; two
  non-blocking taken in round 3: the scratch worktree is rebuilt to the base
  before the control and every proof run (`checkout` plus `clean -fdx`,
  `--with` links excluded), so files a run writes cannot carry into the next;
  the main checkout root comes from `git worktree list --porcelain`, skipping
  a bare entry. Round 3 confirmed `clean -x` never follows links into the main
  tree. T3 done. Also documented: a flagged test that newly imports source
  the base lacks is proved by the import failure (the per-file limit).
- **T5 brief:** takes the `tree-snapshot.sh` index-write fix
  (`GIT_OPTIONAL_LOCKS=0`) for stop-guard.sh's call, since stop-guard.sh is in
  its Touches.
- **T5 (9a91062):** stop-guard tests 90/90. Full suite had two failures not
  from T5: magpie's `shiki` missing (magpie has its own package.json; a fresh
  worktree needed `bun install` in `skills/magpie`, done by the controller),
  and stale eval plugin copies, which T6's `eval:plugins` step resyncs.
- **T5 review:** no blocking; T5 done; the invariant holds from 9a91062.
  Accepted as designed: the test gate can spend a deep run's one refusal per
  turn ahead of the run guard until tests are recorded (D5's order); a
  session moved to another tree goes silent, as the verify gate does; a stale
  record from an earlier session clears identical content (narrow, fails
  open); the gate has no "not mine" exit, so a test the partner edits in their
  own editor is refused every turn until recorded (raised at handback).
  **Fix row T8 added** (tier 1, to T3's implementer, who wrote the code):
  proof mode refused the whole call on any deletion, so an edit beside a
  deletion could never be proved; now deletions are skipped and left for
  `--none`, `--none` records only paths without a current record, and the
  refusal mentions `--with node_modules` and reads per path.
- **T8 (cf04adc):** no blocking; done. Deletions are now treated like any
  non-flagged change, so every run sees the same deletion state. **Open
  policy question for the partner:** `--none` can clear an edit right after
  its proof exited 7 (the gate matches blob and path, not the status column).
  As designed, `--none` is the escape hatch: the reason is on record and the
  meter counts it unproven, and the record file is writable anyway. Options:
  keep it, refuse `--none` for a blob whose proof failed, or have the gate
  treat `unproven` on a non-deleted path differently. Raised at the handback.
- **T6 (4739796):** no blocking; full suite 2178/0. Four wording fixes taken,
  sent back after T7 commits (one writer at a time): say to prove edited
  tests before `--none` for deletions (else `--none` records the edits
  unproven); "records them only if each fails there" (all or nothing); a
  clause on `--with node_modules`; tie "Then" to updating the test. Left: the
  SKILL.md clause is broader than the gate, which is harmless.
- **T7 (fbddbdc):** suite 2178/0; 15 regex grader checks by hand-written
  traces; the llm grader is checkable only by running the eval. Evals not run
  yet (cost model calls; decided after the hunt). `bun run skill:audit`
  reports one error not from this plan: `magpie: description differs:
  skill.json vs index.json (index stale)`; raised at the handback. Flagged by
  the implementer: evals/README.md still says "Nineteen cases" (outside
  Touches); both prompts keep the reference case's `allowed_tools`, which
  lacks AskUserQuestion.
- **T6 round 2 (80af80f):** the four wording fixes landed; checked by the
  controller against the review's points; T6 done.
- **T7 review:** one blocking. Case 2's prompt stated that status output
  stays as it is, which removed the unexpected red test the case exists to
  create. Taken: remove that sentence and update the llm grader; add a grader
  that the requested deploy change happened; README sandbox note (the proof's
  `git worktree add` under $TMPDIR may fail in the macOS sandbox while the
  call-only grader passes); stale fixture comment; README count and tables.
  T7's Touches widened to include evals/README.md. The reviewer ran case 1's
  proof by hand on the fixture outside the sandbox: exit 0, proved.
- **Belongs to existing code, not a plan task:** finding (1) applies to
  `skills/sluice/scripts/content-digest.sh:58`, which copies the index the
  same way, so `status.sh verify` and the verify gate can miss a same-size
  edit made right after an add. Outside every task's Touches; goes to the
  partner at the handback as a separate fix.
- **T2 (1641aa2), from the implementer:** `tree-snapshot.sh`'s `git status`
  rewrites the index stat cache on some runs. T2 set `GIT_OPTIONAL_LOCKS=0`
  for its own call; `stop-guard.sh`'s call still writes. Existing code outside
  Touches; joins the content-digest finding at the handback, unless T5 (which
  touches stop-guard.sh) takes it.

## Hunt

Report: `.bug-hunter/2026-10-18-test-change-gate/` (intent I1-I21,
`findings.json`, repro `hunt-gate.test.ts`). The harness blocked the hunting
agent from writing `report.md`; its summary is in this section instead. 3
bugs, 3 ambiguities, 16 covered.

Bugs, each one fix, test-first, with its repro promoted:
- **S1 (claim I12, all or nothing):** the proof loop fed the flagged list to
  the suite on stdin, so a command reading stdin swallowed the rest, their
  proofs never ran, and every path was recorded proved. Fix T9: every run
  reads `/dev/null`.
- **S17 / S17c (I16, I5; I14, I15):** a tracked test path replaced by a
  directory made `git hash-object` fail and silenced the whole gate, letting
  a loosened test through, and the deletion could never be recorded. Fix
  T10: such a path reads as deleted on both sides.

Ambiguities, to the partner at the handback:
- **S4b:** a session whose only change is editing a test file that was
  untracked at session start is not gated, because `tree-snapshot.sh` does
  not hash untracked content, so the tree never reads as moved. Any other
  tracked edit makes the gate fire.
- **S15:** `tests-changed` run from a subdirectory runs the command at the
  scratch worktree root, as `verify` runs at the tree root, so a
  package-relative command exits 8. No claim decides which is right.
- **Stdin for every run:** settled by T9 (all runs read `/dev/null`).

Fix reviews: T9 (ac388f3) no blocking, done; a post-checkout hook reading
stdin also cannot swallow the list (git gives hooks /dev/null). T10
(2f44cd7) no blocking, but a flagged file that `git hash-object` cannot read
(mode 000) still silenced the whole gate, the shape T10 set out to close;
and a 100% rename into a directory of the same name failed the proof run
loudly, since `--list` printed only rename destinations. Both taken as a
second T10 round; T10's Touches widened to test-changes.sh and its tests.

Not probed by the hunt: run-stats (existing tests cover it), `.gitattributes`
eol/filters in hashing (both sides hash the same way).

## Final review

No blocking findings; full suite 2185/0. A session walked by hand in a
scratch repo cleared the gate by following the refusal. Taken by the
controller: an "Amended during the run" note in the spec for D1 and D4;
test-first.md says "scoped to the updated tests" (a new feature test in the
command makes the control run exit 8); a comment re-wrapped. To the partner
at the handback: one edited non-test file under a test path (a fixture under
`tests/`) that passes on the base exits 7, and with all-or-nothing recording
and no way to name a subset, the real updated test can then only be cleared
with `--none`. Fails safe, never open, but common enough to decide on.
`.bug-hunter/` left untracked, as in the main tree.

## Handback decisions (partner)

- Finish: merge to master, then bump sluice (0.25.0), nothing pushed.
- `--none` after a failed proof: kept as the escape hatch.
- Fixtures: `tests-changed --only <path>` added as T11 before the merge.
- `content-digest.sh` timestamp race: fixed now as a separate fast-channel
  commit on master after the merge.
- Not yet decided, left in the handback: S4b (untracked test edited alone is
  not gated), S15 (subdirectory commands run at the root), the gate's lack of
  a "not mine" exit, magpie's stale index entry.
- T11 (e0642e5): `--only <path>` landed; review found no blocking. The
  controller reworded "carries neither" in test-first.md (44e7283). Known:
  once a fixture is recorded with `--none --only`, later proofs still need
  `--only <test>`, since the fixture stays flagged.
