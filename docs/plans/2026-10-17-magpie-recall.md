# Plan: magpie recall

**Goal:** Raise magpie's recall on the 29 known misses (spec:
`docs/specs/2026-10-17-magpie-recall.md`), measure it with an LLM-judged recall eval, and
keep label precision from collapsing.

**Architecture:** The eval runs first and stays inert (T1 to T4). One flip (T5) adds the
`contracts` focus and the prompt additions. The gate-coverage dedupe and report work (T6)
and the after replay (T7) build on the flip.

## Ground Rules

- All commands run from `skills/magpie` unless stated. Gates: `bun test`, `bun run lint`,
  `bun run typecheck`. All three must pass before a task reports done.
- Commit messages are Conventional Commits in the repo's style, for example
  `feat(magpie): ...`, `test(magpie): ...`, `fix(magpie): ...`, `docs(magpie): ...`.
  Write them as the repo's git user only. No `Co-Authored-By` trailer, no "Generated with"
  footer, no session link, no em dashes.
- The corpus root is `~/.magpie/corpus` (`DEFAULT_CORPUS_ROOT` in `evals/quality/corpus.ts`).
  Nothing derived from client code is written inside the git repo.
- Recall set path: `<corpusRoot>/misses/<runId>.json`.
- Judge default model: `claude-sonnet-5-5`, overridable with `--judge-model`.
- Replay runs: `pr-46-1787748571`, `pr-50-1789099641`, `pr-70-1790391863`, against the clone
  at `~/Documents/projects/workings`, `--max-cost-usd 10` each.
- Match the file you are in: naming, error style, layout. No new dependencies. No `any`,
  `@ts-ignore` or `biome-ignore`. Fail loudly on malformed input, and never default missing data.
- Tests assert observable behaviour with hand-written expected values.
- No em dashes in prose, comments or docs.

### Task 1: Seed the recall set
**Contract:** Needs: none | Offers: `<corpusRoot>/misses/<runId>.json`: a JSON array of `{id: string, file: string, line: number|null, title: string, summary: string, ownerDomain: string, bugClass: string, outsideDiff: boolean, preExisting: boolean, source: string}`
**Touches:** ~/.magpie/corpus/misses/pr-231-1785747503.json (new) | ~/.magpie/corpus/misses/pr-232-1785722708.json (new) | ~/.magpie/corpus/misses/pr-38-1789002973.json (new) | ~/.magpie/corpus/misses/pr-46-1787748571.json (new) | ~/.magpie/corpus/misses/pr-50-1789099641.json (new) | ~/.magpie/corpus/misses/pr-70-1790391863.json (new)
- [ ] Source: the analysis files in `/private/tmp/claude-501/-Users-dikrana-Documents-projects-agent-skills/28389074-0d34-4824-bad2-3110e2d9aabc/scratchpad/misses/<runId>.json`. Write one entry for every issue whose `status` is not `CAUGHT_FINAL` and that is not `knownToMagpieViaExistingComments: true` (the critic-dropped PR 50 issue counts). `id` is `miss-<n>` from 1 per run. `title` is one line written like a finding title. `summary` is the analysis summary. `source` is the sourceRef. `preExisting` is true where the analysis tagged it, and false otherwise -> `python3 -c` count prints 29 entries in total across the six files.
- [ ] PR 38 has no local clone, so the corpus run dir `~/.magpie/corpus/pr-38-1789002973` may be missing. Create no corpus dir; only the misses file -> `ls ~/.magpie/corpus/misses` lists exactly six files.

### Task 2: Recall judge and score
**Contract:** Needs: none | Offers: `type Miss = {id: string; file: string; line: number | null; title: string; summary: string; ownerDomain: string; bugClass: string; outsideDiff: boolean; preExisting: boolean; source: string}`; `type RecallVerdict = {missId: string; findingId: string | null; reason: string}`; `loadMisses(path: string): Promise<Miss[] | null>` (null when the file is absent, throws naming the path and index when malformed); `recallPrompt(misses: Miss[], findings: ReviewFinding[]): string`; `parseRecallVerdicts(text: string, misses: Miss[], findings: ReviewFinding[]): RecallVerdict[]` (throws on a non-array, a miss missing, a miss twice, an unknown missId, or a findingId not in findings); `judgeRecall(input: {misses: Miss[]; findings: ReviewFinding[]; model: string; cwd: string}): Promise<{verdicts: RecallVerdict[]; costUsd: number | null}>`; `scoreRecall(misses: Miss[], verdicts: RecallVerdict[]): RecallScore` where `RecallScore = {misses: number; caught: number; recall: number | null; byDomain: Record<string, {misses: number; caught: number}>; byClass: Record<string, {misses: number; caught: number}>; excludingPreExisting: {misses: number; caught: number; recall: number | null}}`; `DEFAULT_JUDGE_MODEL = 'claude-sonnet-5-5'`; `listCorpusRuns` skips a `misses` entry
**Touches:** evals/quality/recall.ts (new) | evals/quality/__tests__/recall.test.ts (new) | evals/quality/corpus.ts (edit)
- [ ] Tests first, for `parseRecallVerdicts`: it accepts a valid array, and rejects a missing miss, a duplicate miss, an unknown finding id and non-JSON. The verdict array may arrive inside a fenced ```json block or bare -> tests fail before the code exists, then pass.
- [ ] Tests for `scoreRecall` with hand-written verdicts. Example: 3 misses (domains bugs, bugs, security, one preExisting), 2 caught -> `{misses:3, caught:2, recall:2/3, ...}`. Empty misses -> `recall: null` -> pass.
- [ ] Test that `listCorpusRuns` ignores a `misses` directory, using a temp corpus dir with `results`, `misses` and one run -> it returns only the run.
- [ ] `judgeRecall` spawns `claude -p --model <model> --output-format json --tools ""` with the prompt on stdin and no tools. It reads `result` and `total_cost_usd` the way `parseClaudeResult` in `evals/quality/score.ts` does, reusing `claudeFailureMessage` from `replay-critic.ts` on a non-zero exit. The prompt states the judge's job: for each miss, name the one kept finding that describes the same underlying defect, wherever it is anchored, or null, with a reason under 25 words; partial overlap that would not lead the author to the fix is null. Output is a JSON array only -> unit test on `recallPrompt` asserts that it contains every miss id and finding id. There is no live call in tests.
- [ ] Gates pass and the task is committed -> SHA reported.

### Task 3: Wire recall into the full replay
**Contract:** Needs: `loadMisses`, `judgeRecall`, `scoreRecall`, `DEFAULT_JUDGE_MODEL` from Task 2 | Offers: `replay-full.ts --corpus <runId> --repo <path> [--max-cost-usd N] [--judge-model M] [--out <dir>]`, whose result JSON gains `recall: RecallScore | null`, `recallVerdicts: RecallVerdict[] | null`, `judgeModel: string | null` and `judgeCostUsd: number | null`, and whose stdout line gains `, missed-recall <caught>/<misses>` when a misses file exists
**Touches:** evals/quality/replay-full.ts (edit) | evals/quality/README.md (edit)
- [ ] After `scoreReplay`, call `loadMisses(join(corpusRoot, 'misses', `${run.runId}.json`))`. When it is non-null, judge `newKept` and score it. When it is null, write the four fields as null and print nothing extra -> `bun evals/quality/replay-full.ts` with no args still prints usage, and `--judge-model` is accepted by `parseFlags`.
- [ ] README: add a `## Recall` section covering the recall set's purpose, path, entry shape, how it was seeded (2026-10-17 miss analysis: reviewer comments, post-review commits, follow-up fixes), the judge and its model pin, cost (one tool-less call per replay), and confounds (29 misses, PR 50 dominates, judge nondeterminism, 3 of 6 runs need clones not present here) -> gates pass, committed, SHA reported.

### Task 4: Baseline replay
**Contract:** Needs: Task 1's misses files, Task 3's `replay-full.ts` | Offers: `baselineResults`: three baseline result files `~/.magpie/corpus/results/<ts>-full-<runId>.json` and a summary table (per run: kept, precision, label recall, missed-recall, cost)
**Touches:** ~/.magpie/corpus/results/ (new)
- [ ] For each replay run in Ground Rules, `git -C ~/Documents/projects/workings cat-file -e <headRefOid>^{commit}`, and `git fetch origin pull/<n>/head` if that fails. Then `bun evals/quality/replay-full.ts --corpus <runId> --repo ~/Documents/projects/workings --max-cost-usd 10`. The three runs go one at a time, since they share one clone's worktree list -> three result files exist.
- [ ] If a corpus run dir is missing for a run, rebuild with `bun evals/quality/corpus.ts` first -> report the summary table with the result paths. A replay failure is reported verbatim, never retried blindly.

### Task 5: Turn on the contracts focus and the recall prompts
**Contract:** Needs: `baselineResults` (the baseline must be measured on the pre-flip prompts) | Offers: `FOCUS_IDS` includes `'contracts'` (after `'architecture'`, before `'tests'`); a `magpie-specialist-contracts` focus block in `references/specialists.md`; `ShardCoverageEntry`, the log shape `{stage: 'shard-coverage', status: 'partial', reviewed: number[], contractsOnly: number[]}` documented in SKILL.md stage 4
**Touches:** scripts/types.ts (edit) | scripts/render-cmd.ts (edit) | scripts/render-annotation.ts (edit) | scripts/post-cmd.ts (edit) | scripts/preview-cmd.ts (edit) | scripts/render-progress.ts (edit) | scripts/__tests__/types.test.ts (test) | scripts/__tests__/render-progress.test.ts (test) | scripts/__tests__/skill-lint.test.ts (test) | references/specialists.md (edit) | references/scout.md (edit) | SKILL.md (edit) | README.md (edit) | skill.json (edit) | evals/shard-gate-stops-and-asks/prompt.md (edit) | evals/shard-gate-stops-and-asks/graders/asks-before-dispatching.md (edit) | evals/rules.json (edit)
**Flips:** specialist dispatch goes from five focuses per shard to six (`contracts` added), the bugs and security focuses gain the recall sections, the scout reads conventions from parent directories, and the shard gate's partial option goes from skipping shards to a contracts-only pass on them
**Review:** flip; the prompt text is the behaviour
- [ ] Code: add `contracts` to `FOCUS_IDS`; add `contracts: {}` to `perShard` in `render-cmd.ts`, label `Contracts` in `render-annotation.ts` and `post-cmd.ts`, and a `contracts` count in each preview stage in `preview-cmd.ts`. Whatever `render-progress.ts` enumerates per focus gains it too. Test first: a `parseFinding` test that `domain: 'contracts'` is accepted, and a progress render test that shows a Contracts row -> fail, then pass.
- [ ] `references/specialists.md`: add the `### contracts` focus block per the spec's section 4, in the same structure as its siblings ("What to look for" with bold groups, "How to reason" with numbered steps that each require locating the outside-diff code in the worktree and citing file:line, a risk guide, boundaries with security, bugs and architecture, the anchoring rule for unchanged files, and the closing schema line). No findings cap. Add the bugs sections "State that outlives the call", "Test correctness" and "Scripts and platform", and the security section "Sibling entry points", each with the bullets from spec section 3. Update the opening prose: "five subagents per shard" becomes six, and the focus list names contracts -> `grep -c 'magpie-specialist-' references/specialists.md` counts 6 blocks.
- [ ] `references/scout.md` step 4: "Then `CLAUDE.md` and `AGENTS.md` in each directory the diff touches and in every parent directory up to the worktree root. Skip any that do not exist." -> the diff shows the one sentence changed.
- [ ] SKILL.md stage 4, edited as listed below -> `bun test scripts/__tests__/skill-lint.test.ts` passes:
  - five becomes six focuses everywhere, with contracts in the focus list, `6 × <shard count>`, and in-flight agents held at six;
  - the files check expects six files;
  - the partial option reads: each skipped shard still gets the contracts specialist alone, logged as `{stage: shard-coverage, status: partial, reviewed: [<ids>], contractsOnly: [<ids>]}`, and the terminal names the contracts-only shards;
  - the sentence "That log entry is the only record of the gap: the report has no unreviewed marker." stays until Task 6;
  - the stage 5 and other "five" mentions (the Description, README "What it does", skill.json description) become six.
  - If `skill-lint.test.ts` pins five, update its expectation to the new literal value only and say so in the reply.
- [ ] Eval case: in `evals/shard-gate-stops-and-asks`, "35 subagents" becomes 42 and "five specialist focuses" becomes six, in `prompt.md` and `graders/asks-before-dispatching.md` only (agreed in the spec). In `evals/rules.json`, add a rule `skipped-shards-get-contracts-pass` (states `SKILL.md: 4. Specialists`, origin `spec:2026-10-17-magpie-recall`, cases `[]`, with an `unpinned` reason that no case answers the gate) -> `bun run eval:fresh` lint, if the repo has one, or `bun test` at the repo root passes.
- [ ] Gates pass, committed as `feat(magpie): add a contracts specialist and recall prompts` -> SHA reported.

### Task 6: Coverage-aware dedupe and the unreviewed-shards note
**Contract:** Needs: `ShardCoverageEntry` | Offers: `readShardCoverage(log: Array<Record<string, unknown>>): {reviewed: number[]; contractsOnly: number[]} | null` in `scripts/shard.ts` (last partial entry wins; it reads `contractsOnly`, falls back to legacy `skipped` read as unreviewed with `contractsOnly: []` plus a `legacySkipped: number[]` field; null when none); a `RenderFindingsInput.shardCoverage?: {total: number; contractsOnly: Array<{id: number; files: string[]}>; unreviewed: Array<{id: number; files: string[]}>}`
**Touches:** scripts/shard.ts (edit) | scripts/dedupe-cmd.ts (edit) | scripts/render-cmd.ts (edit) | scripts/render-findings.ts (edit) | templates/styles.css (edit) | scripts/__tests__/shard.test.ts (test) | scripts/__tests__/dedupe-cmd.test.ts (test) | scripts/__tests__/render-findings.test.ts (test) | SKILL.md (edit) | README.md (edit)
- [ ] Tests first, each failing before the code and passing after -> `bun test` shows them red, then green:
  - `readShardCoverage` on the new shape, the legacy `skipped` shape, two entries (last wins) and none;
  - `runDedupe` with a 3-shard manifest and a partial entry `reviewed:[1,2], contractsOnly:[3]` expects 12 + 1 files and names only the absent ones;
  - the legacy entry `reviewed:[1,2], skipped:[3]` expects 12 files and does not name shard 3;
  - `renderFindings` with `shardCoverage` shows "1 of 3 shards reviewed by contracts only", with a `title` listing that shard's files, and legacy-skipped shards render as "not reviewed".
- [ ] Implement: `reconcileCoverage` takes the coverage. `render-cmd.ts` reads `log.jsonl` (existing `readLog`) and `shards/manifest.json` to build `shardCoverage`. `prHeader` renders the note beside the diff-source note in a `.shard-coverage` span, styled like `.diff-source` -> the Task 6 tests pass.
- [ ] SKILL.md stage 4: replace "the report has no unreviewed marker" with one line saying the report header names contracts-only and unreviewed shards. README: same in the run layout notes if it is mentioned -> gates pass, committed, SHA reported.

### Task 7: After replay and comparison
**Contract:** Needs: `FOCUS_IDS`, `baselineResults` | Offers: three after result files and a comparison table (per run and pooled: missed-recall before and after, label precision before and after, kept count, cost; plus each newly caught miss with its judge reason)
**Touches:** ~/.magpie/corpus/results/ (new)
- [ ] Same commands as Task 4, one run at a time, against the branch with Task 5 landed -> three new result files.
- [ ] Build the comparison from the result JSON files with a scratchpad script, not from memory -> table reported with result paths.

### Task 8: Skill eval freshness
**Contract:** Needs: `FOCUS_IDS`, `readShardCoverage` | Offers: an `eval:fresh` result path and its diff against the accepted baseline
**Touches:** evals/results/ (new)
- [ ] From the repo root: `bun run eval:fresh run skills/magpie --model claude-opus-5-5`, then `bun run eval:fresh diff skills/magpie <result.json>` -> report pass and fail per case verbatim. Do not run `accept`, which is the user's call at the handback.
