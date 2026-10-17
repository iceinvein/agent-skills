# Design: magpie recall

(Sluice deep channel. Design signed off 2026-10-17; the task plan is
`docs/plans/2026-10-17-magpie-recall.md`.)

## Context

The last round (`docs/specs/2026-10-03-magpie-classification.md`) tuned what magpie keeps.
This round is about what it never finds. I checked eight past runs in `~/.magpie` against
ground truth: review comments from anyone but magpie, commits pushed after the reviewed SHA,
and follow-up fixes on the base branch.

- 66 real issues. I left out 29 that another bot had already raised, which magpie was told not to repeat.
- 36 caught in the final report, 1 dropped by the critic, **29 never raised by any specialist**.
- So the filters are fine and the generation is short. The 29 misses:
  - 17 need code outside the diff: sibling routes sharing a namespace, an import tool
    that collides with a migration, a frozen test clock.
  - ~9 are bugs in test code: real clock under frozen time, races on process-wide
    state, a harness that reads the real database, controls that can't fail.
  - 7 are docs or specs that contradict the code or each other. 4 of these sat in shards
    the gate skipped, which left no trace in the report.
  - 3 are a failure surfaced as a pending state, or a stored flag never re-checked.
  - 4 are platform or convention misses: bash 3.2, macOS permission attribution, a
    `CLAUDE.md` rule in a parent directory.

Goal: raise recall on the known misses, measure it, and keep precision from collapsing.

Decided already: misses are matched by an LLM judge, not by file/line/title.

## 1. Recall set and judge (eval only, no pipeline change)

- **Recall set.** One file per run at `<corpusRoot>/misses/<runId>.json`, outside the repo
  like the rest of the corpus (it holds client code). `listCorpusRuns` (`evals/quality/corpus.ts`)
  skips `misses` the way it skips `results`. Each entry is
  `{id, file, line|null, title, summary, ownerDomain, bugClass, outsideDiff, preExisting, source}`.
  I seed it by hand from this session's analysis (the scratchpad JSON). It is data, so no
  script in the repo writes it.
- **Judge.** New `evals/quality/recall.ts` exports `judgeRecall({misses, findings, model})`.
  It makes one `claude -p --output-format json --model <m>` call with no tools. The prompt
  holds each miss and each new kept finding (`id, file, line, title, description`), and the
  judge returns `[{missId, findingId|null, reason}]`. Parsing is strict: every miss exactly
  once, and every `findingId` must exist. Anything else throws, naming the problem. The judge
  model is fixed by `--judge-model` (default `claude-sonnet-5-5`) so it doesn't move while the
  pipeline does.
- **Scoring.** `scoreRecall` returns `{misses, caught, recall, byDomain, byClass,
  excludingPreExisting}` and is pure, so it is unit-tested with hand-written verdicts.
- **Wiring.** When `misses/<runId>.json` exists, `replay-full.ts` judges after scoring and
  writes `recall` plus the verdicts into its result file. Its printed line gains
  `missed-recall c/n`. Precision against labels stays exactly as it is.
- **Coverage limit.** A replay needs a local clone. Only `workings` is cloned here (PRs 46,
  50, 70: 20 of the 29 misses). PRs 231, 232 and 38 need clones of
  `INX-Software/WorkforceManagement` and `INX-Software/Nexus`.

## 2. Scout reads conventions from parent directories

`references/scout.md` step 4 says "`CLAUDE.md` and `AGENTS.md` in each directory the diff
touches". It becomes "in each directory the diff touches and every parent directory up to
the worktree root". This is a prompt-only change.

## 3. Bugs and security focus additions (prompt-only, `references/specialists.md`)

- **bugs, "State that outlives the call":**
  - a failure mapped to a pending, empty or success state (null meaning "still loading" forever);
  - a stored flag or cache never re-checked against what it describes (a file on disk, a remote record);
  - a missing or deleted resource the UI shows as normal.
- **bugs, "Test correctness"** (tests are code that can be wrong):
  - real-clock dates under a frozen or faked clock;
  - process-wide state touched by tests that run in parallel without serialization;
  - a harness that reads or writes real user data;
  - a check or control that passes when nothing ran;
  - timing thresholds a loaded runner breaks.
- **bugs, "Scripts and platform":**
  - shell portability (bash 3.2 parameter parsing, BSD vs GNU flags, `set -u`);
  - process launch details that change OS attribution (exec vs spawn, which binary the OS credits).
- **security, "Sibling entry points":** when the PR adds or changes a check on one route,
  command or handler, list every entry point that acts on the same resource or id namespace
  and confirm each one enforces it. A command that takes caller-supplied ids must scope them
  to what the caller owns.

## 4. Sixth specialist: `contracts`

A new focus that owns cross-boundary consistency, the biggest miss group.

- **Focus block** `magpie-specialist-contracts`:
  - callers, implementers and consumers outside the diff of any signature, return shape or
    meaning the PR changes;
  - sibling paths that must keep the invariant the PR enforces on one path;
  - other writers of the same data (seeds, importers, migrations, backfills) and unique-key collisions between them;
  - derived or stored state against its source of truth;
  - docs, specs and design files in the diff checked against the code and against each other;
  - references to things that don't exist (skills, files, config keys, scripts).

  Boundaries: exploitability belongs to security, local logic to bugs, structure to
  architecture. The output contract and evidence rules are unchanged. A finding may anchor
  on an unchanged file but must say how this PR triggers it, which the critic already
  requires for `onChangedLine: false`. There is no per-shard cap, because these are
  correctness findings.
- **Code changes (mechanical):**
  - add `contracts` to `FOCUS_IDS` (`scripts/types.ts`). That covers dedupe's expected pairs,
    since `SPECIALIST_FOCUS_IDS` is derived from it;
  - add the per-focus counters in `scripts/render-cmd.ts`, the labels in `render-annotation.ts`
    and `post-cmd.ts` (`FOCUS_LABEL` is a `Record<FocusId>`, so tsc enforces it), and the
    preview fixture counts;
  - the critic is unchanged: `contracts` is not a design domain.
- **SKILL.md:** five becomes six throughout stage 4, so `6 × <shard count>`, waves of six, and
  the six-file check. `README.md` and `skill.json` change to match.
- **Cost:** +20% specialist agents per run.

## 5. Skipped shards get a contracts pass, and the report says what went unreviewed

- **Gate.** The "review only the highest-risk shards" option changes: each skipped shard
  still gets the `contracts` specialist alone, one agent per skipped shard. The coverage log
  entry becomes
  `{stage: shard-coverage, status: partial, reviewed: [...], contractsOnly: [...]}`.
  `skipped` is kept as an alias that readers accept, so the archived runs still parse.
- **Dedupe.** `reconcileCoverage` reads the last `shard-coverage` entry. It expects six pairs
  for each reviewed shard and only `contracts` for each contracts-only shard. Today it names
  every skipped shard's pairs as missing, which is noise.
- **Report.** `render-cmd.ts` reads that entry with the manifest, and `prHeader`
  (`render-findings.ts`) shows a note next to the diff-source note, for example "2 of 7 shards
  reviewed by contracts only". Its title lists those shards' files. This replaces the
  documented "the report has no unreviewed marker".

## Order, flip and measurement

1. Recall eval (section 1). This changes no pipeline behaviour.
2. **Baseline replay** on the workings runs (46, 50, 70) at the current prompts. The cap is
   `--max-cost-usd 10` each, so up to about $30. It measures where we start, plus run-to-run noise.
3. Plumbing for `contracts` and the coverage-aware dedupe and report. This code is inert
   until a prompt dispatches the new specialist.
4. **Flip:** sections 2 to 5's prompt and SKILL.md edits, in one task.
5. **After replay** on the same three runs (about $36, since there is one more specialist).
   I report recall on the misses, precision on labels, and cost against the baseline. The
   numbers decide nothing automatically; you read them and choose to keep or revert.

## Tests that change (needs your agreement)

- The `shard-gate-stops-and-asks` grader and prompt pin "35 subagents" (5 × 7). With six
  focuses the correct count is 42. The test is right today and becomes wrong under this
  design, so I'd update it in the flip task. I'm flagging it because it means editing a test.
- `rules.json` gains rule entries for the new gate wording and the contracts dispatch, and
  `eval:fresh` re-baselines after the flip.

## Verification

- `bun test`, `bun run lint`, `bun run typecheck` in `skills/magpie`.
- Unit tests:
  - `judgeRecall` parsing rejects a missing miss, a duplicate miss and an unknown finding id;
  - `scoreRecall` math on hand-written verdicts;
  - `reconcileCoverage` with a partial entry, in both the new and the legacy shape;
  - the report header note.
- `magpie preview` renders the six-domain fixture and the coverage note.
- Baseline and after replays as above, with result files in `~/.magpie/corpus/results/`.
- `eval:fresh run skills/magpie` after the flip.
