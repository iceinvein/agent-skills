# Design: magpie findings quality and classification

(Sluice deep channel, design stop. After sign-off this is saved as
`docs/specs/2026-10-03-magpie-classification.md`, and the task plan follows as a second stop.)

## Context

Eight past runs in `~/.magpie` with post data (245 final findings, posted or not) show:
- The labels barely vary. 88% `confidence: high`, 69% `should-fix`. Scores only span 4-8, so the
  default threshold of 3 is a dead gate.
- 54% of findings are code-smells or architecture, and they're posted least (44% and 56%). The
  skipped ones are "N copies / no single owner / convention" findings.
- Dedupe barely merges anything and the evidence check has never dropped a finding.
- The critic is the only real filter. It runs in the main conversation, sees only hunks, can't read
  the worktree, and saves no reasons.

Goal: findings you'd post, labels that mean something, and a way to measure both.

Decisions already agreed: Post Recommended posts the top N only. Design cap is 3 per run, with
`--design-cap` to override. The eval builds both replay tiers.

Revised after measurement (2026-10-03): critic-apply applies no design cap by default.
`--design-cap <n>` is opt-in. On pr-70, cap 3 dropped 2 of the 9 posted findings by rule alone
(recall 0.56). With no cap, recall was 0.78 and precision 0.88, against the original critic's 0.50.
The specialists' 3-findings-per-shard limit stays.

## 1. Labels and score come from risk, everywhere

- `parseFinding` (`scripts/types.ts`) derives `severity` from `risk.impact`: critical→blocker,
  high→high, medium→medium, low→low. A severity supplied in the input is ignored. Specialists, the
  critic and peer updates can no longer make severity and risk disagree, and archived reports
  re-render consistently.
- The score is computed with `scoreRisk` (`scripts/score.ts`) wherever it's read (render, critic-apply).
  Nothing trusts a stored `score`, so a peer update to `risk` can't leave it stale. Dedupe still
  writes `score` for `threshold-dropped.json`.
- The specialist contract stops asking for `severity`.

## 2. Evidence snippet

- New contract field: `evidence`. It's required when `line` is non-null: 1-3 consecutive lines
  copied verbatim from the file at `line` (new side).
- `verifyEvidence` (`scripts/evidence-filter.ts`) compares lines with whitespace normalised:
  - Snippet within ±3 lines of `line`: keep.
  - Snippet found exactly once elsewhere in the file: move the anchor there and shift a suggestion's
    start and end lines by the same amount. Recorded as `re-anchored`.
  - Snippet not found anywhere: drop as `evidence-not-found`.
  - Anchored finding with no snippet: drop as `missing-evidence`.
  - All of these go to `evidence-dropped.json` (re-anchors to a new `re-anchored` list in the same
    file) and the dedupe log line.
- The tests-check findings have `line: null`, so they're unaffected.

## 3. Root-cause merge candidates

- `magpie dedupe` also writes `merge-candidates.json`: groups of 2+ surviving findings in the same
  file, within ±8 lines of each other, from different domains. The title-token merge keeps its
  current behaviour.
- The critic decides whether each group is one root cause (see 5). Code never merges on proximity
  alone.

## 4. Scout collects repo review rules

- `brief.json` gets `reviewRules: Array<{ rule: string, source: string }>`. The scout reads
  `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING*`, `.github/copilot-instructions.md`, `.cursor/rules/*`,
  and nested `CLAUDE.md`/`AGENTS.md` in changed directories. It keeps only rules that bear on review
  (code shape, testing, conventions, banned patterns), each with its source path.
- `parseBrief` stays lenient: malformed entries are skipped. The report's brief header shows them.
  The specialist brief block (part 5) and the critic prompt both include them under "Repository
  review rules".

## 5. Critic becomes a subagent that owns the labels

- **`magpie critic-prompt "$RUN_DIR" [--batch-size 30]`** builds the prompt from
  `references/critic.md` in code: candidates (compact, with `evidence` and `onChangedLine`), merge
  candidate groups, repo rules, worktree path, diff path. It writes `critic-prompt[-k].md`.
  Substitution moves out of orchestrator prose, so the skill and the eval replay can't build
  different prompts.
- **Stage 6** dispatches one `general-purpose` subagent per batch, in parallel. Each reads the
  worktree to check claims and writes `critic[-k].json`.
- **Critic contract**, per candidate:
  `{ id, verdict: "keep"|"drop"|"merge", reason, mergeInto?, risk?, checked: string[] }`.
  - `risk` is required on `keep`: the critic re-labels the finding.
  - `checked` lists the `file:line` refs it read to verify the claim.
  - `merge` requires `mergeInto` pointing at a kept id.
- **Rubric changes:**
  - Re-derive each claim against the worktree, not the finding's prose.
  - Apply the repo review rules, and drop findings those rules contradict.
  - Code-smells/architecture findings must name a concrete near-term change they break.
  - Duplication needs 3 or more copies, or 2 that already disagree.
- **`magpie critic-apply "$RUN_DIR" [--design-cap 3]`**, deterministic and tested:
  - Reads every `critic*.json`. It fails loudly (non-zero exit, names the ids) on any candidate with
    no verdict, an unknown id, a `merge` whose target isn't kept, or a `keep` with no `risk`.
  - Applies the critic's `risk`. A `confidence: high` with empty `checked` is capped to `medium`.
  - Folds merges into `mergedFrom`, the same shape dedupe uses.
  - Applies the design cap: code-smells + architecture keeps beyond the cap, lowest score first, are
    dropped with reason `design-cap`.
  - Writes `findings.kept.json` and `critic-dropped.json` (every drop with its reason) and logs
    `{stage: critic, status: done, kept, dropped, merged, capped}`.

## 6. Code-smells and architecture retune (prompts)

- Code-smells: duplication needs 3+ copies, or 2 that already disagree (name both file:lines).
  Every finding's `Why it matters:` names the specific future change that would break.
- Architecture: drop the "hardcoded values should be configurable" and "switch chains should be
  polymorphic" prompts unless a second variant already exists in the PR. "No single owner" findings
  must name the concrete divergence they cause.
- Both: report at most 3 findings per shard, the strongest first. The run-level cap in
  critic-apply is the backstop.

## 7. Report: top N, rest folded

- Actionable findings (`must-fix`/`should-fix`) in the issues list are sorted by computed score.
  The first N (default 10, set with `magpie render ... --top <n>`) are marked
  `data-recommended="true"`. The rest sit behind "Show K more". Suggestions keep their existing
  hidden toggle.
- Post Recommended and Select recommended use `data-recommended` only, so they cover the top N.
  The button count reflects N.
- The file view still shows every finding inline.

## 8. Dismiss reasons and labels

- Each card gets a Dismiss menu with four reasons: `wrong`, `not-worth-it`, `duplicate`, `style`.
  It posts `{type: "dismiss", findingId, reason}` (or `undismiss`) to the existing `/events`
  endpoint. A dismissed card dims and unticks. Render reads the events, so a re-render keeps
  dismissals.
- The post paths send `via: "recommended"|"selected"|"one"|"cli"`, and post-cmd logs it on its post
  events. This records the Post Recommended confound.
- **`magpie labels "$RUN_DIR"`** writes `labels.json`:
  `{id, label: "posted"|"dismissed"|"ignored", reason?, via?}`. The last event per id wins, and
  posted beats dismissed. `magpie cleanup` runs it before archiving, so every archived run carries
  labels.

## 9. Quality eval (`skills/magpie/evals/quality/`, outside the install bundle)

- **Corpus lives in `~/.magpie/corpus/<runId>/`, never in the repo** (client code). `bun
  evals/quality/corpus.ts` gathers every run with post data: `pr.json`, `diff.patch`,
  `findings.deduped.json` as candidates, `findings.kept.json`, `findings.final.json`, and
  `labels.json` (derived with the same function as `magpie labels` when it's missing).
- **Baseline scoring, no LLM:** precision is posted ÷ (posted + dismissed + ignored) among kept.
  Recall is posted findings kept ÷ all posted. Reported per domain and split by `via`, and
  dismissed-kept counts come with reasons.
- **Critic tier:** `bun evals/quality/replay-critic.ts --corpus <id> --repo <path>`:
  1. Cuts a worktree at `headRefOid` in a scratch dir.
  2. Runs `magpie critic-prompt`, then `claude -p` per batch with Read/Grep/Glob tools, writing
     `critic-k.json`.
  3. Runs `magpie critic-apply`, then scores against labels by exact id.
- **Full tier:** `replay-full.ts --corpus <id> --repo <path>`:
  1. Scaffolds a run dir from the corpus (worktree, diff, shards via `magpie shard`, brief re-run).
  2. Drives stages 3-6 with `claude -p` running the magpie skill, stopping before peer review.
  3. Matches new findings to labelled ones: same file, line within ±5, and title-token Dice ≥ 0.4
     using `tokenize`/`diceCoefficient` from `scripts/dedupe.ts`. Unmatched new findings are
     reported as `unlabelled`.
  - Costs a few dollars per PR. The README states this.
- Results go to `~/.magpie/corpus/results/<ts>.json` plus a printed table.

## Rollout

Code that accepts the new shapes ships first, and old shapes keep working: no `evidence` on an old
run's findings only matters at dedupe, which archived runs never re-run. The single flip task then
edits `SKILL.md` and `references/*.md` together, since the agent reads those live. Release as
magpie 0.13.0. The `evals/` cases' fixtures that hand-build a stage 6 run are updated in the flip
task.

## Verification

- Unit tests (`bun test` in `skills/magpie`) for each deterministic piece:
  - severity derivation
  - evidence keep, re-anchor and drop cases
  - merge candidate grouping
  - `parseBrief` reviewRules
  - critic-apply (every failure mode, confidence cap, merge, design cap)
  - top-N render and recommended attribute
  - dismiss event folding into labels
  - corpus baseline scoring on a hand-written fixture
- Expected values written by hand.
- `bun run lint && bun run typecheck`.
- Baseline eval on the real corpus. Then critic-tier replay on 2-3 corpus PRs to compare precision
  and recall with the baseline. Report the numbers, whichever way they go.
- `claude plugin eval skills/magpie --scaffold ...` to confirm the existing stage cases still pass.
- `magpie preview` to eyeball the fold and dismiss UI.
