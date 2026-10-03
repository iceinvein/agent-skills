# Plan: magpie-classification

## Goal

Magpie's findings carry labels that mean something, the critic checks claims against the code and
owns those labels, the report surfaces only what is worth posting, and an eval measures precision
and recall against what was actually posted. Design: `docs/specs/2026-10-03-magpie-classification.md`.

## Architecture

Deterministic pieces land in code first, each tested and inert until the walkthrough uses them:
- severity derived from risk in `parseFinding`
- evidence snippet verification and merge candidates in `magpie dedupe`
- `magpie critic-prompt` / `magpie critic-apply`
- `magpie labels` with dismiss events and `via` logging
- top-N fold in the report
- an eval harness under `evals/quality/`

One task (Task 6) switches the agent over by rewriting `SKILL.md` and `references/*.md` together,
because the orchestrating agent reads those live. Task 1's severity derivation is visible on
re-render (severity now always matches `risk.impact`). That's a deliberate consistency fix in code,
not gated by the flip. Task 7 measures the result on the real corpus.

## Ground Rules

- Working directory for every command: `skills/magpie` (relative paths below are from there unless
  they start with `docs/`).
- Commit message convention: `<type>(magpie): <subject>`, subject lower case, no trailing full
  stop. No `Co-Authored-By` trailer, no tool footer, no session link.
- Test runner: `bun test`. Green at 449 tests before Task 1. Also `bun run lint` and
  `bun run typecheck` must pass before a task reports done.
- No new dependency in `package.json`.
- Prose (comments, docs, prompts) has no em dashes. Comments say why, never what.
- Tests assert what a caller observes: return values, files written, exit codes, stdout. Expected
  values are written by hand, never produced by running the code under test. One behaviour per
  test, named for it. No tests for getters, constants, or mock call logs.
- Match the surrounding file: naming, error style, `logLine` JSONL logging, `Bun.file`/`node:fs`
  usage as the neighbouring code does.
- Fail loudly at boundaries. No defaults invented for missing data, no widened catches, no
  `any` / `biome-ignore` / `@ts-ignore`.
- The eval corpus lives in `~/.magpie/corpus/` and is never written inside the repo. It holds
  client code.
- Severity mapping (exact): impact `critical`→`blocker`, `high`→`high`, `medium`→`medium`,
  `low`→`low`.
- Design cap default `3`. Top-N default `10`. Critic batch size default `30`. Merge-candidate radius
  `8` lines. Evidence window `±3` lines. Full-tier match: same file, line within `±5`, title Dice
  `>= 0.4`.
- Dismiss reasons (exact strings): `wrong`, `not-worth-it`, `duplicate`, `style`. `via` values
  (exact): `recommended`, `selected`, `one`, `cli`.

### Task 1: types: derived severity, evidence field, review rules

**Contract:** Needs: none | Offers: `deriveSeverity(risk: Risk): Severity` exported from `scripts/types.ts`; `parseFinding` returns `severity: deriveSeverity(risk)` regardless of input severity, and carries `evidence?: string` (kept only when a non-empty string); `ReviewFinding.evidence?: string`; `type ReviewRule = { rule: string; source: string }`; `PrBrief.reviewRules: ReviewRule[]` (parseBrief keeps entries where both are non-empty strings after trim, `[]` when absent or not an array)
**Touches:** scripts/types.ts (edit) | scripts/__tests__/types.test.ts (test) | scripts/__tests__/render-findings.test.ts (test)

- [ ] Add tests: each of the four impact values maps to its severity; a finding with `severity: "low"` and `risk.impact: "high"` parses as `high`; a missing severity no longer throws or coerces; `evidence` round-trips when it's a string and is absent when empty or non-string; `parseBrief` with `reviewRules: [{rule:"x",source:"CLAUDE.md"},{rule:"",source:"a"},"bad"]` yields one rule; missing `reviewRules` yields `[]` -> new tests fail
- [ ] Implement in types.ts. Leave `coerceSeverity` in place only if another module still imports it, otherwise delete it and its synonym tables -> `bun test` green, lint and typecheck green
- [ ] Commit `feat(magpie): derive severity from risk and parse evidence and review rules` -> SHA reported

### Task 2: dedupe: evidence snippets and merge candidates

**Contract:** Needs: `ReviewFinding.evidence?: string` | Offers: `verifyEvidence(findings, worktreePath): Promise<{ kept: ReviewFinding[]; dropped: EvidenceDrop[]; reanchored: Array<{ id: string; file: string; from: number; to: number }>; skipped: boolean }>` where `EvidenceDrop.reason` is `'hallucinated-file' | 'invented-line' | 'missing-evidence' | 'evidence-not-found'`; `findMergeCandidates(findings: ReviewFinding[], radius?: number): string[][]` exported from `scripts/dedupe.ts` (groups of ids, each group 2+ findings in one file, anchored, within `radius` (default 8) lines of another member, from 2+ distinct domains); `magpie dedupe` writes `merge-candidates.json` (JSON array of id arrays, `[]` when none) and records `reanchored` in `evidence-dropped.json` as `{ dropped, reanchored }` and in the dedupe log line as counts
**Touches:** scripts/evidence-filter.ts (edit) | scripts/dedupe.ts (edit) | scripts/dedupe-cmd.ts (edit) | scripts/__tests__/evidence-filter.test.ts (test) | scripts/__tests__/dedupe.test.ts (test) | scripts/__tests__/dedupe-cmd.test.ts (test) | scripts/__tests__/pipeline-e2e.test.ts (test)

- [ ] Add evidence tests against a temp worktree file you write by hand (details below) -> new tests fail
  - snippet at the exact line is kept
  - snippet 2 lines off is kept with its line unchanged
  - snippet found once 20 lines away re-anchors, and its suggestion start/end shift by the same delta
  - snippet found twice outside the window drops as `evidence-not-found`
  - snippet absent drops as `evidence-not-found`
  - anchored finding with no evidence drops as `missing-evidence`
  - `line: null` with no evidence is kept
  - comparison ignores leading/trailing whitespace and runs of internal whitespace
- [ ] Add `findMergeCandidates` tests (details below) -> fail
  - two findings from different domains 5 lines apart group together
  - same domain does not group
  - 9 lines apart does not group
  - a chain A(10, bugs), B(16, security), C(22, architecture) forms one group
  - unanchored findings never group
- [ ] Add dedupe-cmd tests: `merge-candidates.json` is written with the expected groups; re-anchors appear in `evidence-dropped.json` -> fail
- [ ] Implement. Multi-line evidence matches as consecutive lines -> `bun test` green, lint and typecheck green
- [ ] Commit `feat(magpie): verify evidence snippets and emit merge candidates in dedupe` -> SHA reported

### Task 3: critic-prompt and critic-apply

**Contract:** Needs: `deriveSeverity(risk: Risk): Severity`; `ReviewFinding.evidence?: string`; `type ReviewRule = { rule: string; source: string }`; `PrBrief.reviewRules: ReviewRule[]` | Offers: `scripts/critic.ts` exporting `type CriticVerdict = { id: string; verdict: 'keep' | 'drop' | 'merge'; reason: string; mergeInto?: string; risk?: Risk; checked: string[] }`, `buildCriticPrompts(input: { template: string; candidates: ReviewFinding[]; mergeCandidates: string[][]; reviewRules: ReviewRule[]; worktree: string; diffPath: string; runDir: string; batchSize: number }): Array<{ batch: number; prompt: string; outputPath: string }>` (single batch uses `critic.json`, else `critic-<k>.json`; placeholders `<<CANDIDATES>>`, `<<MERGE_CANDIDATES>>`, `<<REVIEW_RULES>>`, `<<WORKTREE>>`, `<<DIFF_PATH>>`, `<<OUTPUT_PATH>>`; a merge group is included in a batch only when all its ids are in that batch, and batching keeps merge groups together), `applyCriticVerdicts(input: { candidates: ReviewFinding[]; verdicts: CriticVerdict[]; designCap: number }): { kept: ReviewFinding[]; dropped: Array<{ id: string; reason: string }>; merged: number; capped: number }` (throws `Error` listing every offending id for: candidate with no verdict, verdict for unknown id, duplicate verdict, `keep` without valid `risk`, `merge` without `mergeInto` or whose target is not kept); CLI `magpie critic-prompt <run-dir> [--batch-size N]` writes `critic-prompt.md` or `critic-prompt-<k>.md` per batch from the `magpie-critic` fenced block in `references/critic.md`, prints one line per batch `<prompt path>\t<output path>`; CLI `magpie critic-apply <run-dir> [--design-cap N]` reads `critic.json` or every `critic-<k>.json`, writes `findings.kept.json` and `critic-dropped.json`, logs `{stage: 'critic', status: 'done', kept, dropped, merged, capped}`, exits 1 with the error on stderr when `applyCriticVerdicts` throws
**Touches:** scripts/critic.ts (new) | scripts/critic-cmd.ts (new) | bin/magpie.ts (edit) | scripts/__tests__/critic.test.ts (test) | scripts/__tests__/critic-cmd.test.ts (test)

- [ ] Add `applyCriticVerdicts` tests with hand-built candidates (details below) -> fail
  - keep applies the critic's risk and derives severity from it
  - `confidence: high` with `checked: []` becomes `medium`
  - drop lands in `dropped` with its reason
  - merge appends `{domain, title}` to the target's `mergedFrom` and removes the source
  - with cap 3 and five design-domain keeps scoring 7.0, 6.5, 6.0, 5.5, 5.0, the two lowest drop with reason `design-cap` and `capped: 2`
  - bugs findings are never capped
  - each throw case names its id
- [ ] Add `buildCriticPrompts` tests (details below) -> fail
  - 3 candidates, batch size 30: one prompt with every placeholder replaced, output `<runDir>/critic.json`
  - 65 candidates, batch size 30: three prompts with outputs `critic-1.json`..`critic-3.json`
  - a merge group straddling a batch boundary ends up whole in one batch
- [ ] Add CLI tests in a temp run dir (details below) -> fail
  - critic-prompt with a template file containing all six placeholders writes the prompt file(s) and prints the paths
  - critic-apply writes `findings.kept.json` and `critic-dropped.json`
  - critic-apply with a missing verdict exits 1 and names the id

  The CLI reads the template from the `magpie-critic` block of `references/critic.md`. Tests point
  it at a temp template through an exported option on the command function (`templatePath`), not
  an env var.
- [ ] Implement. Register both subcommands in `bin/magpie.ts` and its USAGE text. `findings.deduped.json`, `merge-candidates.json` (treated as `[]` when absent, because runs from before this change lack it) and `brief.json` (rules `[]` when absent) are the inputs -> `bun test` green, lint and typecheck green
- [ ] Commit `feat(magpie): add critic-prompt and critic-apply` -> SHA reported

### Task 4: dismiss reasons, post via, and labels

**Contract:** Needs: none | Offers: `scripts/labels.ts` exporting `type FindingLabel = { id: string; label: 'posted' | 'dismissed' | 'ignored'; reason?: 'wrong' | 'not-worth-it' | 'duplicate' | 'style'; via?: 'recommended' | 'selected' | 'one' | 'cli' }` and `foldLabels(input: { findingIds: string[]; postStatus: PostStatusMap; events: Array<Record<string, unknown>>; log: Array<Record<string, unknown>> }): FindingLabel[]` (last dismiss/undismiss event per id wins; `posted` beats dismissal; `via` from the latest `{stage:'post', status:'ok', id, via}` log entry for that id) and `readDismissed(runDir: string): Promise<Map<string, string>>` (id to reason, after folding); CLI `magpie labels <run-dir>` writes `labels.json` from `findings.final.json`; `magpie cleanup` runs it before archiving when `findings.final.json` exists; card markup carries a Dismiss control emitting `{type:'dismiss', findingId, reason, timestamp}` / `{type:'undismiss', findingId, timestamp}` to `/events`; `renderAnnotation` accepts `dismissed?: string` and renders `data-dismissed="<reason>"`; post requests from the page carry `via` and post-cmd writes `via` onto each `{stage:'post', status:'ok'}` log entry
**Touches:** scripts/labels.ts (new) | scripts/labels-cmd.ts (new) | bin/magpie.ts (edit) | scripts/render-diff.ts (edit) | scripts/render-issues-list.ts (edit) | scripts/__tests__/render-diff.test.ts (test) | scripts/__tests__/render-issues-list.test.ts (test) | scripts/cleanup-cmd.ts (edit) | scripts/post-cmd.ts (edit) | scripts/server.ts (edit) | scripts/helper.js (edit) | scripts/render-annotation.ts (edit) | scripts/render-findings.ts (edit) | scripts/render-cmd.ts (edit) | templates/styles.css (edit) | scripts/__tests__/labels.test.ts (test) | scripts/__tests__/cleanup-cmd.test.ts (test) | scripts/__tests__/post-cmd.test.ts (test) | scripts/__tests__/server.test.ts (test) | scripts/__tests__/render-annotation.test.ts (test) | scripts/__tests__/helper.test.ts (test)

- [ ] Add `foldLabels` tests (details below) -> fail
  - posted id gets `posted` with `via` from the log
  - dismiss then undismiss gives `ignored`
  - undismiss then dismiss `style` gives `dismissed` with reason `style`
  - dismissed then posted gives `posted`
  - an id with no events gives `ignored`
  - a failed post entry (`{status:'failed'}` in post-status) is not `posted`
- [ ] Add tests (details below) -> fail
  - cleanup leaves `labels.json` in the archived dir
  - a server `/post` and `/api/post-review` body with `via: "recommended"` produces log entries carrying `via` (dry-run paths)
  - render-annotation with `dismissed: "wrong"` renders `data-dismissed="wrong"` and an unchecked checkbox
  - helper's dismiss handler posts the event (follow the existing helper.test.ts pattern)
- [ ] Implement (details below) -> `bun test` green, lint and typecheck green
  - render-cmd reads `state/events` through `readDismissed` and passes the map down
  - dismissed cards are dimmed in styles.css and excluded from Select/Post Recommended
  - `cli` is the `via` for `magpie post`
- [ ] Commit `feat(magpie): record dismiss reasons and post source as labels` -> SHA reported

### Task 5: report top-N fold

**Contract:** Needs: `renderAnnotation` accepting `dismissed?: string` | Offers: `renderIssuesList` input gains `topN: number`; actionable findings (not `isSuggestion`, not dismissed) render sorted by `scoreRisk(f.risk)` descending (ties keep input order), the first `topN` carry `data-recommended="true"`, the rest sit inside a `<div class="more-findings" hidden>` revealed by a `data-action="toggle-more"` button reading `Show <K> more`; `renderActionBar` input gains `topN: number` and shows `Post Recommended (<min(topN, actionable)>)`; helper's select/post recommended act on `[data-recommended="true"]` checkboxes only; `magpie render <run-dir> findings --top <n>` (default 10) threads `topN` through `renderFindingsToDisk`
**Touches:** scripts/render-issues-list.ts (edit) | scripts/render-action-bar.ts (edit) | scripts/render-findings.ts (edit) | scripts/render-cmd.ts (edit) | bin/magpie.ts (edit) | scripts/helper.js (edit) | templates/styles.css (edit) | scripts/preview-cmd.ts (edit) | scripts/refresh.ts (edit) | scripts/__tests__/refresh.test.ts (test) | scripts/__tests__/render-findings.test.ts (test) | scripts/__tests__/preview-cmd.test.ts (test) | scripts/__tests__/skill-lint.test.ts (test) | scripts/__tests__/render-issues-list.test.ts (test) | scripts/__tests__/render-action-bar.test.ts (test) | scripts/__tests__/render-cmd.test.ts (test) | scripts/__tests__/helper.test.ts (test)

- [ ] Add tests (details below) -> fail
  - 12 actionable findings with distinct risks and topN 10: the 10 highest by the score you computed by hand carry `data-recommended="true"` in descending order
  - the other 2 are inside the hidden `more-findings` block
  - the toggle reads `Show 2 more`
  - suggestions are never recommended
  - a dismissed finding is never recommended
  - the action bar reads `Post Recommended (10)`
  - with 4 actionable findings it reads `(4)` and renders no toggle
  - `render --top 3` yields 3 recommended
  - helper's select-recommended ticks only recommended boxes
- [ ] Implement -> `bun test` green, lint and typecheck green; `bun bin/magpie.ts preview --no-open` renders without error
- [ ] Commit `feat(magpie): fold the report past the top recommended findings` -> SHA reported

### Task 6: switch the walkthrough and prompts over

**Contract:** Needs: `magpie critic-prompt <run-dir> [--batch-size N]`; `magpie critic-apply <run-dir> [--design-cap N]`; `magpie labels <run-dir>`; `magpie render <run-dir> findings --top <n>`; `merge-candidates.json`; placeholders `<<CANDIDATES>>`, `<<MERGE_CANDIDATES>>`, `<<REVIEW_RULES>>`, `<<WORKTREE>>`, `<<DIFF_PATH>>`, `<<OUTPUT_PATH>>`; `CriticVerdict` shape; `PrBrief.reviewRules`; `EvidenceDrop` reasons | Offers: the agent runs the new pipeline
**Touches:** SKILL.md (edit) | references/critic.md (edit) | references/specialists.md (edit) | references/scout.md (edit) | references/peer-review.md (edit) | README.md (edit) | skill.json (edit) | scripts/__tests__/skill-lint.test.ts (test) | evals/codex-missing-falls-back/fixture.sh (edit) | evals/report-ends-the-turn/fixture.sh (edit) | evals/post-folds-selection-events/fixture.sh (edit) | evals/README.md (edit)
**Flips:** the agent stops writing severity, starts supplying evidence snippets, gets retuned design focuses, collects repo review rules, and runs the critic as worktree-reading subagents through critic-prompt/critic-apply. It replaces the in-conversation hunk-only critic that wrote `findings.kept.json` by hand.
**Review:** flip; prompt prose has no executable test of its own

- [ ] `references/specialists.md` Output Contract (details below) -> skill-lint updated to expect `evidence` and no `"blocker"` severity enum in the contract, green
  - remove `severity` from the schema and the severity coherence bullet
  - add `evidence` (required with a non-null `line`: 1-3 consecutive lines copied verbatim from the file at `line`, new side; the anchor is dropped if not found)
  - brief block (part 5) adds a "Repository review rules" list rendered from `reviewRules` as `- <rule> (<source>)`, omitted when empty
- [ ] Code-smells focus block (details below) -> the blocks still pass skill-lint's per-focus checks
  - duplication needs 3+ copies, or 2 that already disagree, naming both file:lines
  - `Why it matters:` must name the specific future change that would break
  - at most 3 findings per run header scope, strongest first

  Architecture focus block:
  - drop "Hardcoded values that should be configurable" and "Switch/if-else chains that will grow" unless a second variant already exists in the PR
  - ownership findings name the concrete divergence they cause
  - the same 3-finding limit
- [ ] `references/scout.md` (details below) -> read through once against `parseBrief`
  - add step: read `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING*`, `.github/copilot-instructions.md`, `.cursor/rules/*` at the root, and `CLAUDE.md`/`AGENTS.md` in directories the diff touches
  - keep only rules bearing on review, each with its source path
  - contract grows to five keys with `reviewRules: Array<{rule, source}>`, `[]` when none
  - the return line becomes `brief: <N> changes, <K> watch items, <R> review rules`
- [ ] `references/critic.md` rewritten. The `magpie-critic` block (details below) -> skill-lint expects the six placeholders and `CriticVerdict` field names, green
  - uses the six placeholders
  - instructs the subagent to open the worktree and re-derive each claim from the code at `evidence`/`line`
  - list every `file:line` read in `checked`
  - re-label `risk` on keep
  - apply the review rules
  - decide each merge-candidate group (merge into the strongest, or leave separate)
  - require code-smells/architecture keeps to name a concrete near-term breaking change
  - write the JSON array to `<<OUTPUT_PATH>>` and return one line `critic: <kept> kept, <dropped> dropped, <merged> merged`
- [ ] `SKILL.md` (details below) -> skill-lint green
  - stage 5 mentions `merge-candidates.json` and the evidence drop reasons
  - stage 6 becomes: run `magpie critic-prompt "$RUN_DIR"`, dispatch one `general-purpose` subagent per printed batch in one message, confirm each output file exists, run `magpie critic-apply "$RUN_DIR"` and, on a non-zero exit, re-dispatch the batch holding the named ids
  - stage 7 states peer `fields.severity` is ignored (derived from risk)
  - stage 8 notes `--top`
  - stage 9 mentions Dismiss and that Post Recommended takes the top N
  - stage 10 notes `labels.json`
  - remove the old in-conversation critic substitution prose and the >40 batching paragraph it owned
- [ ] `references/peer-review.md`: drop `severity` from the update/add examples and the compact jq field list -> green
- [ ] README and skill.json description reflect the critic subagent, evidence check and labels. Bump `skill.json` version to `0.13.0` -> `bun test` green
- [ ] Update eval fixtures that hand-write stage 6 artifacts so a resumed run still finds what it expects. Run `claude plugin eval skills/magpie --scaffold --allow-tools Bash Write Edit --runs 1 --ablation none` from the repo root -> all five cases pass, or failures reported verbatim
- [ ] Commit `feat(magpie): run the critic as worktree-reading subagents that own risk labels` -> SHA reported

### Task 7: quality eval harness

**Contract:** Needs: `foldLabels(input: { findingIds: string[]; postStatus: PostStatusMap; events: Array<Record<string, unknown>>; log: Array<Record<string, unknown>> }): FindingLabel[]`; `type FindingLabel`; `magpie critic-prompt <run-dir> [--batch-size N]`; `magpie critic-apply <run-dir> [--design-cap N]` | Offers: `evals/quality/score.ts` exporting `scoreSelection(input: { labels: FindingLabel[]; keptIds: string[]; findings: ReviewFinding[] }): QualityScore` with `type QualityScore = { kept: number; posted: number; postedKept: number; dismissedKept: Record<string, number>; precision: number | null; recall: number | null; byDomain: Record<string, { kept: number; postedKept: number }>; byVia: Record<string, number> }` and `matchFindings(newFindings: ReviewFinding[], labelled: ReviewFinding[]): Map<string, string>` (new id to labelled id; same file, line within ±5, Dice ≥ 0.4 on `tokenize(title)`, best Dice wins, each labelled id matched at most once); scripts `evals/quality/corpus.ts` (build), `evals/quality/baseline.ts`, `evals/quality/replay-critic.ts --corpus <runId> --repo <path>`, `evals/quality/replay-full.ts --corpus <runId> --repo <path> [--max-cost-usd N]`
**Touches:** evals/quality/score.ts (new) | evals/quality/corpus.ts (new) | evals/quality/baseline.ts (new) | evals/quality/replay-critic.ts (new) | evals/quality/replay-full.ts (new) | evals/quality/README.md (new) | evals/quality/__tests__/score.test.ts (test) | tsconfig.json (edit)

- [ ] Add `scoreSelection` tests on a hand-written fixture of 6 findings (2 posted kept, 1 posted dropped, 1 dismissed `wrong` kept, 2 ignored kept): precision 2/5, recall 2/3, `dismissedKept.wrong` 1, per-domain counts as written. Zero kept gives precision `null`. Add `matchFindings` tests: a 4-line offset with similar titles matches; a 6-line offset does not; a different file does not; two candidates for one labelled finding resolve to the higher Dice -> fail
- [ ] Implement score.ts -> green
- [ ] `corpus.ts` (details below) -> run it, corpus lists the 8 runs
  - for every run under `~/.magpie` (active and archived) with `post-status.json` and `findings.final.json`, copy `pr.json`, `diff.patch`, `findings.deduped.json`, `findings.kept.json`, `findings.final.json`, `merge-candidates.json` and `brief.json` when present into `~/.magpie/corpus/<runId>/`
  - write `labels.json` via `foldLabels` over `state/events` and `log.jsonl`
  - print one line per run with counts
  - refuses to run if the resolved corpus dir is inside the repo
- [ ] `baseline.ts`: scores each corpus run's original `findings.kept.json` against its labels, prints a table, and writes `~/.magpie/corpus/results/<ts>-baseline.json` -> run it, numbers printed
- [ ] `replay-critic.ts` (details below) -> README documents usage and cost
  1. `git -C <repo> worktree add --detach <scratch> <headRefOid>`, and fail loudly if the sha is missing
  2. Copy the corpus files into a scratch run dir.
  3. `bun bin/magpie.ts critic-prompt`, then per batch `claude -p --allowedTools Read,Grep,Glob,Write --output-format json` with the prompt on stdin.
  4. `critic-apply`, then `scoreSelection`, writing `results/<ts>-critic-<runId>.json`.
  5. Remove the worktree in a `finally`.
- [ ] `replay-full.ts` (details below) -> README documents usage and cost. Not run in this task.
  1. Scaffold a run dir from the corpus with a worktree as above and `magpie shard`.
  2. Run `claude -p` with the magpie skill and a prompt to resume stages 3-6 on that run dir (`magpie status` drives the resume) and stop after `findings.kept.json`, with `--max-cost-usd` passed through (default 10).
  3. `matchFindings` against `findings.final.json`, then score with unmatched counted as `unlabelled`.
- [ ] Commit `feat(magpie): add a quality eval over posted-finding labels` -> SHA reported

### Task 8: measure

**Contract:** Needs: `evals/quality/corpus.ts`; `evals/quality/baseline.ts`; `evals/quality/replay-critic.ts --corpus <runId> --repo <path>` | Offers: none
**Touches:** docs/plans/2026-10-03-magpie-classification-record.md (edit)

- [ ] Build the corpus and run baseline -> table recorded in the run record
- [ ] Run replay-critic on 2-3 corpus PRs whose repos are cloned locally (ask for the clone paths when a repo isn't findable under `~/Documents/projects`) -> before/after precision and recall recorded, whichever way they go
