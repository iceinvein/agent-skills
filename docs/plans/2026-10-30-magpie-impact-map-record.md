# Run record: magpie impact map

Spec: `docs/specs/2026-10-30-magpie-impact-map.md`. Plan: `docs/plans/2026-10-30-magpie-impact-map.md`.
Requested by the agent-skills-40 session on the user's behalf; design and plan signed off by
the user on 2026-10-30.

## Alignment checks

- **Intent check** (before design sign-off): 5 findings, all 5 fixed in the spec. D4 was a
  path only, which is the pull model, so it became a fork and the user chose the hybrid. The
  SKILL.md cap is 3500, not 3000, and the file sits at 3489 (the user agreed to raise it to
  3600). The phase B gate became the user's choice. D2 kinds 2 and 4b were listed as
  additions with their targets. `critic.md` was added to the conflict list.
- **Plan check** (before pre-flight): 5 findings. Fixed 3:
  - a shard with no impact file now gets no `Outside the diff:` line, never the run-wide map;
  - Task 3 now pins with a test that an `impact` log entry changes neither status nor progress;
  - Task 9 now stops for the user's go-ahead instead of starting on the automatic bar.

  Two were raised with the user rather than fixed: phase A's cap arithmetic (worst case about
  $63), settled by the $60 ceiling below, and the D1/D6 exit-code conflict, resolved in the
  plan in D6's favour with a note on Task 3.

## Pre-flight

- **Review:** 5 dispatches, at T1, T2, T3 and T4 (tier 1: later tasks build on them) and T6
  (tier 3: the flip). T5, T8 and T9 are paid measurement whose output the controller reads
  directly; T7 is three version strings checked by the existing manifest tests. Chosen by the
  user from the recommended option.
- **Effort:** T7 at low effort (mechanical, exact strings, existing tests cover it). The other
  8 run at session effort, because each carries judgement or spends money. User ratified.
- **Workspace:** this worktree (`.claude/worktrees/magpie-impact-map`, branch
  `magpie-impact-map`). Implementers run serially, since the contract graph is a chain with
  no overlap, and each agent commits its own task and reports the SHA. Nothing touches
  master. Chosen by the user.
- **Spend:** phase A ceiling $60 (expected about $50). Phase B (about $210, ceiling $320 in
  total) runs only after the user reads phase A and says go.

## Decisions
- T1 brief settles three choices the plan left open:
  - "used" names are identifiers immediately followed by `(` on added lines of code files,
    plus backticked identifiers on added lines of `.md`/`.mdx` files, minus names the diff
    defines, deduplicated by name (first occurrence kept). All identifiers would be noise.
  - `buildImpactMap` assigns a hit to every name that occurs in the hit's text as a whole
    word, so one grep call per kind can carry many `-e` patterns.
  - Patterns given to `git grep -E` use POSIX classes (`[[:space:]]`), not `\b` or `\s`.
    The design trace showed `\b` silently matching nothing under this machine's git.
- T1 review (tier 1), round 1: 2 blocking, 6 non-blocking. Sent back to the implementer:
  - blocking: CRLF and U+2028 lines make `parseGrepOutput` throw; non-ASCII paths come back
    C-quoted from git and slip past every path check;
  - non-blocking, taken: grep-side `const` column-0 rule, built-in receivers and
    `update(`/`delete(` creating table stores, same-path route callers dropped, lowercase SQL
    missed, no integration test of the `-E` patterns.
  - non-blocking, carried to T3's brief: `git grep` exits 1 on no match, which is not an error.
- T1 fix round 5872d48: all 7 taken. Contract change: `GrepHit` gains a required
  `indented: boolean` set by `parseGrepOutput`, because the column-0 rule needs it after the
  text is trimmed. T2 and T3 briefs must carry the new shape.
- T1 review round 2: both blocking fixes confirmed against real git grep; the changed tests
  were changed for the fixes, not loosened. 3 non-blocking:
  - taken (round 3): lowercase `from`/`update`/`join` inside English strings
    ("read from disk", "update your password") and `from sqlalchemy import select, update`
    made stores; `-i` writer hits from comments and `.md` prose. Noise listed as fact defeats
    the map, so it is fixed now with the reviewer's exact inputs as tests.
  - left: `core.quotePath=false` still C-quotes paths holding `\`, `"` or a newline. No crash,
    a wrong path on a rare filename; `-z` parsing would fix it if it ever shows up.
- T1 round 3 01112f6: prose no longer yields stores. Accepted one rule beyond the brief:
  lowercase SQL outside a string counts only in `.sql` files on a line with a SQL verb, so
  lowercase migrations still yield stores. Closed without a fourth review: the controller ran
  the gates (786 pass, lint, tsc) and the fix is pinned by the reviewer's own inputs as tests.
  Left untested: `with`-led SQL strings, comment markers other than `//` on the writer side.
- T2 brief: `GrepHit` carries `indented: boolean` (T1 round 1); T2 does not build GrepHits,
  so nothing else changes for it.
- `status.sh ready` lists T7 as ready because "the flip commit" is not a parseable symbol;
  T7 is held until T6 lands, as the plan's order says.
- T2 brief settles the entry shapes the plan left open: the diff-side location of an entry
  is `definedAt[0]` for symbols, `usedIn` for uses and routes, `usedIn[0]` for stores; a doc
  entry renders as `- file:line \`text\` (names: a, b)` with no child lines.
- T2 review (tier 1), round 1 on 4f0e923: 1 blocking, 3 non-blocking, plus the controller's
  doc-shard finding. Sent back together:
  - blocking: an entry with 12 children (about 2.5 KB) exceeds the 2 KB brief cap, and the
    longest-prefix rule then empties the brief. Fix: a `maxChildren` render option
    (`IMPACT_BRIEF_MAX_CHILDREN = 3` for the brief, with the existing `N of M shown` line) plus
    skip-ahead fitting, so the highest-ranked entries survive in short form rather than being
    skipped whole. Contract change: `renderImpactMarkdown` opts gain `maxChildren?: number`;
    T3 must pass it for the `.brief.md` files.
  - controller: docs carried no shard and so reached no numbered-shard file, which would hide
    the doc facts aimed at pr-50 misses 1 and 5 on a 7-shard run. Fix: `ImpactDoc` gains
    `shards: number[]` from its mentions. This is in `scripts/impact.ts`, so T2's Touches widen
    to `impact.ts` and `impact.test.ts` for this round (serial run, no overlap).
  - taken: throw when the cap is below the count line; double-backtick code spans for text
    holding a backtick; drop entries with no child facts (stores without writers, routes
    without siblings, uses without definitions, symbols with zero listed references unless
    they are too common to list).
- T2 review round 2 on 3e95f54: no blocking findings; the three changed tests were changed
  for the agreed behaviour, not loosened. Left: a doc naming a basename shared by changed
  files in two shards attaches to both (one extra lead line), and a symbol defined in two
  shards attaches its docs only to the first definition's shard. Both cost at most a line.
- T3 brief settles: `shardOf` returns null when the manifest has 0 or 1 shards (unsharded
  runs write no shard files); `excluded(file)` follows the same include/exclude logic setup's
  path filter applies; empty Markdown is not written (no `impact.md` when the run has no
  entries, matching "no file for a shard with no entries"), while `impact.json` is always
  written on success; `git grep` exit 1 is an empty result, exit 2 or more is the skip path;
  brief files pass `maxChildren: IMPACT_BRIEF_MAX_CHILDREN`.
- T3 review (tier 1) on 3ce3023: no blocking findings, 3 non-blocking. The controller then ran
  `magpie impact` on the real pr-70 run (scratch run dir, workings worktree at the head SHA):
  the definitions plan was one `git grep -E` with 1236 ERE alternatives (412 used names x 3)
  and ran for minutes. Combined with the reviewer's ARG_MAX finding (about 4000 names breaks
  argv), this is a design defect in T1's search shape, not a tuning issue. Fix round, with
  T3's Touches widened to `scripts/impact.ts` and its test:
  - all plans become fixed-string, whole-word searches whose patterns go to `git grep` on
    stdin (`-F -w -f -`); definition, writer and SQL shape checks move into `buildImpactMap`.
    Contract change: `GrepPlan` gains `patterns: string[]`.
  - `magpie shard` returns 0 after a successful split whatever `runImpact` returns (impact
    logs its own outcome).
  - `.magpie.json` is read from the checkout setup read it from (the main checkout in PR mode,
    found through `git rev-parse --git-common-dir`; the review root in local mode), with a
    test of the include-list branch.
- Old-shape run on real pr-70: 2:50 wall (776 s CPU) before its `git grep` was terminated
  (exit 143, SIGTERM, cleared ahead of the new timing). It logged
  `{stage: impact, status: skipped}` and exited 0, so the skip path held on real data.
- T3 fix round 12926ec: pr-70 `magpie impact` in 18.5 s (was 2:50+, killed). Implementer
  additions accepted: `GREP_BATCH = 5` (git grep -F slows superlinearly in pattern count;
  measured 4.9 s for 50 names in one search, 0.9 s as ten batches of five) with hit dedupe,
  and a once-per-hit definitions index. `git grep -P` was faster still but needs a PCRE
  build of git, so it stays `-F`.
- Trace confirmed on real data: `impact.shard-4.brief.md` for pr-70 opens with the writers of
  `videoVerification` and `reportVerification` (both registration routes, the admin deletes),
  which is miss-1's ground, then `scripts/seed-report-locks.ts` as a writer of `reportLocks`.
- Docs were noise: 9346 doc lines, led by `status` (1647), `live`, `video`, `mod.rs`. Sent back:
  a doc mention whose name or basename has more than COMMON_NAME_HITS doc lines is dropped,
  and at most MAX_REFS_PER_NAME doc lines are kept per name.
- T3 doc fix 06e7b8b: pr-70 docs 9346 -> 695, impact.json 3.1 MB -> 677 KB, 18.1 s.
- T3 review round 2: no blocking findings; no filtering lost in the move to JS shape checks;
  test changes limited to the argv change, integration expectations byte-identical. Left:
  the PR-mode config lookup takes `dirname(--git-common-dir)`, which is wrong for a submodule
  or a separate GIT_DIR and then silently uses the default filter; `--path-format=absolute`
  needs git 2.31+. Rare, and the cost is a filter mismatch on grep hits, not a crash.
- T4 brief settles: no paid `claude -p` call runs in T4 (pure helpers are unit-tested; the
  CLI is exercised only up to prompt assembly with a `--dry-run` flag that prints the prompt
  and exits); part 5 is rendered from `brief.json` by a helper in the probe that follows the
  part-5 template in `references/specialists.md`; `excludedFiles` is true only when the corpus
  run has `excluded-files.json`; `target` is `PR #<number>` from `pr.json`; `costUsd` is the
  stream-json `result` event's `total_cost_usd`.
- T4 review (tier 1) on 9c16210: 1 blocking, 7 non-blocking; prompt assembly matches the live
  specialists.md part by part and the arms differ only in the header line and part 6. Fix round:
  - blocking: `.replace('<top entries>', inline)` expands `$&`, `` $` ``, `$'` from code text;
  - controller: `<the path above>` must be filled with the impact path, as production does;
  - taken: the impact arm refuses to run (before paying) when its shard has no impact file,
    which overrides the T4 brief's choice 4, since a run with no map measures nothing; the
    result file is written before anything after the session can throw; a `judged` flag
    separates "judge failed" from "caught nothing"; one test assembles from the live file;
  - README notes only: `countOutsideCitations` is a lower bound (exact `path:line` only);
    findings are judged before dedupe's evidence filter, the same on both arms; `git worktree
    prune` after an interrupted probe.
- T4 review round 2 on 945e002: no blocking findings; no path after a paid session loses its
  cost or findings, and cleanup always runs. 3 non-blocking, all taken because they decide
  whether paid repeats survive: a post-session failure aborts the remaining repeats; a
  truncated transcript line skips the judge on the impact arm; the results dir is created
  only after the session. Closed on the controller's gate run after the fix, no round 3.
- T4 closed at 3d94ba7 on the controller's gate run (872 pass, lint, tsc). Repeats now survive
  a post-session failure; transcripts with cut-off lines are scored; the results dir is
  checked writable before any spend.
- T5 runs controller-side: each pair is one CLI invocation whose output is result files, so a
  dispatch would buy no context saving. A runner script sums `costUsd + judgeCostUsd` over
  this phase's result files after every pair and stops past $30.
- pr-50 miss-5's file (`generate-ocr-truncated-id-no-ax-scenario.ts`) is not in the diff, so
  by the plan's rule its pair uses `docs/specs/2026-09-09-full-journey-scenario-design.md`
  (the same shard as miss-6, under the architecture focus).
- The scratch `real-pr70` worktree from the T3 check is still registered in the workings
  clone; removed at the end of measurement.

## Phase A, base arm (T5)

21 runs, no errors, $14.87 (sessions about $0.26 to $1.44, judge about $0.02 each). Result
files `~/.magpie/corpus/results/2026-10-30T*-probe-*-base-r*.json`.

| Pair | Focus, shard | Findings per run | Caught |
|---|---|---|---|
| pr-70 miss-1 | security s4 | 1, 1, 1 | 0/3 |
| pr-70 miss-2 | security s5 | 1, 1, 1 | 0/3 |
| pr-70 miss-3 | bugs s4 | 0, 0, 0 | 0/3 |
| pr-50 miss-1 | architecture s6 | 2, 3, 2 | 0/3 |
| pr-50 miss-5 | architecture s3 (fallback file) | 2, 2, 0 | 0/3 |
| pr-50 miss-6 | bugs s3 | 0, 0, 0 | 0/3 |
| pr-50 miss-9 | bugs s5 | 4, 0, 3 | 1/3 (r3) |

Pooled: 1 of 21 (miss, repeat) catches. Eight runs wrote zero findings (unjudged by design).
- T6 brief settles: part 6's block holds `<top entries>` and `<the path above>`, and the part 6
  instruction tells the orchestrator to fill both (the probe already does); proof includes a
  `--dry-run` of the probe's impact arm assembling from the live specialists.md.
- T6 review (tier 3) on 731a686: no blocking findings. Production prose and the probe build the
  same prompt for sharded, unsharded and no-impact-file shards. Changed existing lines in the
  shared files: 3 count words (specialists "five" to "six", critic "six" to "seven" twice), all
  required. Changed tests ask no less of the code. Taken in a fix round (T6 Touches widened to
  `scripts/impact-cmd.ts` and its test):
  - specialists.md: the impact part is pasted as-is (no `<RUN_DIR>` substitution inside it),
    and part 6 and the header line are skipped when the matching `.brief.md` is absent;
  - `runImpact` writes each file to a temp name and renames it into place, so an interrupted
    run cannot leave a truncated `impact.json` that blocks `critic-prompt`.
  Left: the resume clause sits in stage 3 prose, so a run resumed past stage 3 never re-runs
  impact; harmless because the map is optional.
- T6 closed at 5c2652c on the controller's gate run (878 pass, lint, tsc); atomic writes, pasted-as-is and skip-without-brief rules in.
- T7 (low effort) and T8 (controller-run script) run together: disjoint paths, and T8's probe reads no file T7 edits.
- T7 e371d6d: 0.16.0 in the three manifest files; root suite 2658 pass. Skipped review per pre-flight.

## Phase A, impact arm (T8) and the gate

21 runs, no errors, $14.71. Phase A total $29.58 (estimate was about $50, ceiling $60).

| Pair | Focus, shard | Findings per run (impact) | Caught: base | Caught: impact |
|---|---|---|---|---|
| pr-70 miss-1 | security s4 | 1, 1, 0 | 0/3 | 1/3 (r2) |
| pr-70 miss-2 | security s5 | 1, 1, 1 | 0/3 | 0/3 |
| pr-70 miss-3 | bugs s4 | 0, 0, 1 | 0/3 | 0/3 |
| pr-50 miss-1 | architecture s6 | 3, 1, 2 | 0/3 | 0/3 |
| pr-50 miss-5 | architecture s3 | 1, 2, 2 | 0/3 | 0/3 |
| pr-50 miss-6 | bugs s3 | 0, 0, 0 | 0/3 | 0/3 |
| pr-50 miss-9 | bugs s5 | 4, 0, 2 | 1/3 | 0/3 |
| **Pooled** | | | **1/21** | **1/21** |

- Read rate of the full impact file: 0 of 21. Every impact-arm run had a map (the probe refuses
  a shard without one, and none was refused), so the facts reached the agents only through the
  inline brief (about 2 KB).
- `citesOutside`: 0 on both arms. A lower bound (exact `file:line` only), so it does not show
  the facts went unused, but nothing shows they were used either.
- **Gate verdict: fails on both terms** (catch gain 0, bar 3 or more; read rate 0, bar above
  0.5). The one impact catch (pr-70 miss-1, the uuid namespace whose writers the shard-4 brief
  lists first) is one run in three and the base arm swapped in its own single catch, which is
  the run-to-run variance the 2026-10-17 record warned of.
- Per the plan, T9 (phase B) does not start without the user's go-ahead.
- The scratch `real-pr70` worktree is removed from the workings clone; no probe worktree remains.

## Decision: skip phase B, revert the flip, keep the tooling

- User decision (2026-10-30), from the recommended options: phase B is not run, so T9 is left
  `blocked` in run.json as "not run by the user's choice" (sluice has no cancelled status).
  Phase A spend $29.58 is the run's whole measurement spend.
- Reverted in e3fdfd0: the flip 731a686, the 0.16.0 bump e371d6d, and the specialists.md lines
  of 5c2652c. Every file the flip and bump touched is byte-identical to its pre-flip state
  (`git diff 731a686~1` over those paths is empty). Kept: `magpie impact` (scripts/impact.ts,
  impact-render.ts, impact-cmd.ts with its atomic writes), the `magpie shard` re-run, and the
  probe harness with replay-full's `impactBytes`. None of it runs in a review until a prompt or
  stage calls it. Gates after the revert: 874 pass, lint, tsc; SKILL.md back to 3489 words.
- Reading: a deterministic map pushed into the prompt did not move recall on the targeted
  misses, and the full file was never opened. With the 2026-10-17 probe (more instructions)
  and the code-intelligence history (tools on demand), that is a third channel that did not
  change what specialists raise on these shards. The facts were present (pr-70 shard 4's brief
  led with the writers behind miss-1) and still produced one catch in three, the same rate as
  the base arm's single catch elsewhere.
