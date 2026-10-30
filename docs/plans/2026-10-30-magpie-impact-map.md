# Plan: magpie impact map
**Spec:** docs/specs/2026-10-30-magpie-impact-map.md

**Goal:** Give magpie's specialists and critic deterministic facts about code outside the diff
(references, definitions the diff relies on, other writers of the same data, sibling routes,
docs), and measure whether it raises recall on the replayable misses.

**Architecture:** Pure extraction (T1) and rendering (T2) land first, then the `magpie impact`
command (T3) and the probe harness (T4). None of these change a review, because no prompt or
stage reads them yet. Phase A's base arm (T5) runs on that inert tree. One flip (T6) wires the
map into the specialist prompt, the critic prompt and stage 3. A version bump (T7), phase A's
impact arm with the gate reading (T8), and phase B, which runs only if T8 passes (T9), build on
the flip.

## Ground Rules

- Work happens in the worktree `/Users/dikrana/Documents/projects/agent-skills/.claude/worktrees/magpie-impact-map`,
  branch `magpie-impact-map`. Never edit the main tree, which another session is using.
  Never merge or push.
- All commands run from `skills/magpie` unless stated. Gates:
  `bun test`, `bun run lint`, `bunx -p typescript tsc --noEmit`. `bun run typecheck` exits
  127 because `tsc` is not installed, so it is not the gate. All three must pass before a
  task reports done.
- Commit messages are Conventional Commits in the repo's style: `feat(magpie): ...`,
  `test(magpie): ...`, `fix(magpie): ...`, `docs(magpie): ...`, `chore(magpie): <version>`.
  Write them as the repo's git user only. No `Co-Authored-By` trailer, no "Generated with"
  footer, no session link, no em dashes. Each task commits its own work and reports the SHA.
- No new dependency. All searching is `git grep` run with the review root as cwd. No ctags,
  ast-grep, tree-sitter or rg.
- Do not edit `scripts/setup-cmd.ts`, `scripts/gh.ts`, `scripts/incremental.ts` or
  `references/scout.md`. Edits to `references/specialists.md`, `references/critic.md` and
  `SKILL.md` are appended blocks or single added lines; existing sentences are not reworded.
- Constants live in `scripts/impact.ts` and take these exact values:
  `MIN_NAME_LENGTH = 4`, `MAX_REFS_PER_NAME = 12`, `COMMON_NAME_HITS = 200`,
  `TEXT_MAX_CHARS = 160`. The stoplist is `NAME_STOPLIST = ['self', 'this', 'that', 'data',
  'value', 'values', 'result', 'error', 'props', 'index', 'name', 'test', 'main', 'type',
  'item', 'items', 'list', 'info', 'args', 'opts', 'options', 'config', 'state', 'event',
  'input', 'output', 'path', 'file', 'text', 'line', 'next', 'done', 'none', 'true', 'false',
  'null', 'undefined', 'return', 'async', 'await', 'export', 'import', 'const', 'string',
  'number', 'boolean', 'object']`.
- Render caps live in `scripts/impact-render.ts`: `IMPACT_FULL_CAP_BYTES = 8192`,
  `IMPACT_BRIEF_CAP_BYTES = 2048`. The truncation line reads exactly
  `N more entries in impact.json` with N the count left out.
- Entry order when rendering: stores, then symbols of kind `changed` or `removed`, then
  symbols of kind `added`, then uses, then routes, then docs. Within a kind, order by file
  then line.
- "Outside the diff" means not on an added line of the new side. Context lines and unchanged
  lines in changed files count as outside. Paths excluded by the path filter
  (`loadPathFilterConfig` and `matchesAny` in `scripts/path-filter.ts`) are never listed.
- `magpie impact <run-dir>`: a missing or invalid run dir is a usage error (stderr line,
  exit 2). Any other failure (git grep error, unreadable diff) appends
  `{stage: "impact", status: "skipped", error: <message>, ts}` to `log.jsonl`, writes one
  stderr line, and exits 0. Success appends
  `{stage: "impact", status: "done", symbols, uses, stores, routes, docs, ts}` with counts.
- Tests: written first and watched failing; one behaviour per test; expected values written by
  hand, never produced by running the code under test. Integration tests build a real git repo
  in a temp dir and run real `git grep`.
- Match the file you are in: naming, error style, layout. No `any`, `@ts-ignore` or
  `biome-ignore`. Fail loudly on malformed input; never default missing data.
- Measurement: corpus root `~/.magpie/corpus`, clone `--repo ~/Documents/projects/workings`.
  Probe cap `--max-cost-usd 3` per run. Phase A spend ceiling $60 in total; phase B caps
  `--max-cost-usd 45` (pr-50) and `20` (pr-70), spend ceiling $320 in total. Stop and report
  rather than exceed a ceiling. Nothing derived from client code is written inside the repo.
- Recall judge: `judgeRecall` from `evals/quality/recall.ts`, default model
  `claude-sonnet-5-5`.

### Task 1: Extract names from the diff and plan the searches
**Existing:** parseUnifiedDiffToHunks(diff: string): DiffHunk[] and splitDiffByFile(diff: string): Map<string, string> in scripts/diff-utils.ts.
**Contract:** Needs: none | Offers: in `scripts/impact.ts`: `type ImpactLocation = { file: string; line: number }`; `type ImpactRef = { file: string; line: number; text: string }`; `type ImpactSymbol = { name: string; kind: 'added' | 'changed' | 'removed'; definedAt: ImpactLocation[]; shard: number | null; hits: number; references: ImpactRef[] }`; `type ImpactUse = { name: string; usedIn: ImpactLocation; shard: number | null; definedAt: ImpactRef[] }`; `type ImpactStore = { name: string; kind: 'table' | 'file'; usedIn: ImpactLocation[]; shard: number | null; writers: ImpactRef[] }`; `type ImpactRoute = { path: string; usedIn: ImpactLocation; shard: number | null; siblings: ImpactRef[] }`; `type ImpactDoc = { file: string; line: number; text: string; mentions: string[] }`; `type ImpactMap = { version: 1; symbols: ImpactSymbol[]; uses: ImpactUse[]; stores: ImpactStore[]; routes: ImpactRoute[]; docs: ImpactDoc[] }`; `type DiffNames = { defined: Array<{ name: string; kind: 'added' | 'changed' | 'removed'; file: string; line: number }>; used: Array<{ name: string; file: string; line: number }>; stores: Array<{ name: string; kind: 'table' | 'file'; file: string; line: number }>; routes: Array<{ path: string; file: string; line: number }>; changedFiles: string[]; addedLines: Map<string, Set<number>> }`; `extractDiffNames(diff: string): DiffNames`; `type GrepHit = { file: string; line: number; text: string }`; `parseGrepOutput(out: string): GrepHit[]` (parses `git grep -n` lines `path:line:text`, text trimmed and cut at `TEXT_MAX_CHARS`); `type GrepPlan = { kind: 'references' | 'definitions' | 'writers' | 'routes' | 'docs'; args: string[] }`; `planSearches(names: DiffNames): GrepPlan[]` (each `args` is a full argv after `git`, starting with `grep`, including `-n`); `buildImpactMap(input: { names: DiffNames; hits: Record<GrepPlan['kind'], GrepHit[]>; shardOf: (file: string) => number | null; excluded: (file: string) => boolean }): ImpactMap`; and the constants and `NAME_STOPLIST` from Ground Rules.
**Touches:** skills/magpie/scripts/impact.ts (new) | skills/magpie/scripts/__tests__/impact.test.ts (test)
**Builds:** D2
- [ ] Write `impact.test.ts` with hand-written diffs, one behaviour per test, covering: a TS `export function foo(` on an added line yields `defined` kind `added`; a definition on both a removed and an added line yields kind `changed`; a definition only on a removed line yields `removed`; a hunk header `@@ -10,3 +10,4 @@ fn wire_job(` with a changed body yields `wire_job` kind `changed`; Rust `fn`, Python `def`, Go `func`, shell `name() {` each recognised; names shorter than 4 characters and stoplisted names skipped; a backticked name in a `.md` added line goes to `used`; `.from(videoVerification)` and `INSERT INTO report_locks` yield table stores; a `"history.db"` literal yields a file store; a `"/api/verify/x"` literal yields a route; `parseGrepOutput` handles a path containing `:` only when followed by `<digits>:` and cuts text at 160; `planSearches` emits `-w -F` per-name `-e` args for references and no `-w` for file-store literals; `buildImpactMap` drops hits on added lines, drops excluded paths, keeps at most 12 references while `hits` keeps the true count, lists a name with more than 200 hits with `references: []`, and assigns `shard` via `shardOf` -> `bun test scripts/__tests__/impact.test.ts` fails on the missing module.
- [ ] Implement `scripts/impact.ts` to the Contract. Definition patterns by extension: `.ts .tsx .js .jsx .mjs .cjs` (`function`, `class`, `interface`, `type`, `enum`, `const|let|var X =`, with optional `export`, `default`, `async`); `.rs` (`fn`, `struct`, `enum`, `trait`, `type`, `const`, `static`, with optional `pub`, `pub(crate)`, `async`); `.py` (`def`, `class`); `.go` (`func`, `func (recv)`, `type`); `.sh .bash` (`name() {`, `function name`). Writer verbs for table stores: `insert(`, `update(`, `delete(`, `into(` and SQL `INSERT INTO`, `UPDATE`, `DELETE FROM`, `REPLACE INTO`; table names are taken from those plus `from(`, `FROM`, `JOIN`. File stores are string literals ending `.db`, `.sqlite`, `.sqlite3`. Route siblings share the first two path segments. Docs are `.md` and `.mdx` files outside the diff mentioning a changed symbol or a changed file's basename -> `bun test scripts/__tests__/impact.test.ts` passes, then all three gates pass.
- [ ] Commit `feat(magpie): extract outside-diff search targets from a diff` -> `git show --stat HEAD` lists only the two Touches paths.

### Task 2: Render the map as Markdown and for critic candidates
**Existing:** ReviewFinding in scripts/types.ts.
**Contract:** Needs: `ImpactMap` (type from `scripts/impact.ts`, Task 1, with its member types) | Offers: in `scripts/impact-render.ts`: `IMPACT_FULL_CAP_BYTES = 8192`; `IMPACT_BRIEF_CAP_BYTES = 2048`; `renderImpactMarkdown(map: ImpactMap, opts: { shard: number | null; capBytes: number }): string` (with `shard: null` renders every entry; with a number renders entries whose `shard` equals it; returns `''` when nothing matches); `renderImpactForCandidates(map: ImpactMap | null, candidates: ReviewFinding[]): string` (entries whose anchor file or any listed outside file equals some candidate's `file`, rendered under `IMPACT_FULL_CAP_BYTES`, or exactly `(none)` when `map` is null or nothing matches)
**Touches:** skills/magpie/scripts/impact-render.ts (new) | skills/magpie/scripts/__tests__/impact-render.test.ts (test)
**Builds:** D3, D5
- [ ] Write `impact-render.test.ts` with a hand-built `ImpactMap` and hand-written expected Markdown: one section heading per kind present (`### Other writers of the same data`, `### References to changed symbols`, `### References to added symbols`, `### Definitions this change relies on`, `### Sibling routes`, `### Docs naming what changed`), each entry as `- \`name\` (diff: file:line)` followed by indented `  - file:line \`text\`` lines and a `  - 12 of 230 shown` line when `hits` exceeds the listed count; a common name renders as `- \`name\`: 230 hits, too common to list`; the shard filter; the order from Ground Rules; the cap cutting whole entries and ending with `N more entries in impact.json`; `''` for an empty match; `renderImpactForCandidates` returning `(none)` for null and for no match, and selecting by anchor file and by outside file -> the suite fails on the missing module.
- [ ] Implement `scripts/impact-render.ts` to the Contract. The cap counts UTF-8 bytes and never cuts inside an entry -> the render suite passes, then all three gates pass.
- [ ] Commit `feat(magpie): render the impact map for prompts` -> `git show --stat HEAD` lists only the two Touches paths.

### Task 3: The `magpie impact` command
**Existing:** reviewRoot(runDir: string): Promise<string> in scripts/target.ts; loadPathFilterConfig(cwd: string): Promise<PathFilterConfig> and matchesAny(path: string, patterns: readonly string[]): string | null in scripts/path-filter.ts; ShardManifest in scripts/shard.ts.
**Contract:** Needs: `extractDiffNames`, `planSearches`, `parseGrepOutput`, `buildImpactMap`, `ImpactMap`, `GrepPlan` (Task 1); `renderImpactMarkdown`, `IMPACT_FULL_CAP_BYTES`, `IMPACT_BRIEF_CAP_BYTES` (Task 2) | Offers: in `scripts/impact-cmd.ts`: `runImpact(runDir: string): Promise<number>` (writes `impact.json`, `impact.md`, `impact.brief.md`, and per non-empty shard `impact.shard-<n>.md` and `impact.shard-<n>.brief.md` when the manifest has more than one shard; removes stale `impact*.md` and `impact.json` from an earlier run first; logs and exits as Ground Rules say); `readImpactMap(runDir: string): Promise<ImpactMap | null>` (null when `impact.json` is absent; throws naming the file when it is present but malformed); CLI `magpie impact <run-dir>`; `magpie shard` calls `runImpact` after re-splitting when `impact.json` exists
**Touches:** skills/magpie/scripts/impact-cmd.ts (new) | skills/magpie/bin/magpie.ts (edit) | skills/magpie/scripts/__tests__/impact-cmd.test.ts (test)
**Note:** spec D1 says a failure exits non-zero; D6, written later, says a skipped run logs and exits 0. This task follows D6 and the Ground Rules (exit 0 on a logged skip, exit 2 on a usage error). Do not change it to follow D1.
**Builds:** D1, D3, D6
- [ ] Write `impact-cmd.test.ts` as integration tests over a temp git repo the test builds and commits: a TS module with `export function sealReport(` called from two files, a `db.insert(reportLocks)` writer in a third file, a `docs/design.md` naming `sealReport`, and a `"/api/locks/report"` route next to `"/api/locks/video"`. The test writes a run dir by hand (`diff.patch` that changes `sealReport`'s body and adds a `.from(reportLocks)` line, `target.json` with `{mode: "pr", root: <repo>}`, `shards/manifest.json` with two shards, `log.jsonl`). Assert, with hand-written expected values: `impact.json` lists both callers with their real line numbers, the writer, the sibling route and the doc line; `impact.shard-1.md` holds only shard 1's entries; no `impact.shard-2.md` is written when shard 2 has none; the done log line carries the counts; a run dir whose `target.json` root is not a git repo logs `skipped`, writes no `impact.json` and exits 0; a missing run dir exits 2; `readImpactMap` returns null without the file and throws on `{}`; a second run removes an `impact.shard-3.md` the first left behind -> the suite fails on the missing module.
- [ ] Implement `scripts/impact-cmd.ts`, add the `impact` entry to the dispatch table and usage text in `bin/magpie.ts` (lazy import, as the other entries do), and make the `shard` entry call `runImpact(runDir)` after `shardDiff` when `<runDir>/impact.json` exists -> the suite passes; add one test to `impact-cmd.test.ts` that runs `bun bin/magpie.ts shard <runDir> --budget 1` on that run dir and asserts the per-shard files now match the new manifest; all three gates pass.
- [ ] Pin that an `impact` stage entry in `log.jsonl` changes neither `magpie status` nor the progress render: add one test to `impact-cmd.test.ts` that builds a run dir with a fixed log, runs the status and progress-render functions on it, appends `{stage: "impact", status: "done", ...}` and `{stage: "impact", status: "skipped", ...}` entries, and asserts both outputs equal the hand-written expected output from before the append. Watch it pass on the current code (it pins existing behaviour D6 relies on) and confirm it goes red if `impact` is added to the stage list -> the test passes; if it fails on the current code, stop and report, since D6 assumes the opposite.
- [ ] Commit `feat(magpie): magpie impact writes the outside-diff map` -> `git show --stat HEAD` lists only the three Touches paths.

### Task 4: Specialist probe harness and replay diagnostics
**Existing:** judgeRecall, loadMisses, Miss and RecallVerdict in evals/quality/recall.ts; loadCorpusRun, copyCorpusFiles, headRefOid, readFindings and resolveCorpusRoot in evals/quality/corpus.ts; worktreeRemoveCommand and claudeFailureMessage in evals/quality/replay-critic.ts; ReviewFinding in scripts/types.ts.
**Contract:** Needs: `runImpact(runDir: string): Promise<number>` (Task 3, called through `bun bin/magpie.ts impact`) | Offers: `evals/quality/probe-specialist.ts` CLI: `bun evals/quality/probe-specialist.ts --corpus <runId> --repo <path> --focus <focus> --file <diff path> --misses <id,id> --arm base|impact --repeats <n> [--max-cost-usd N] [--judge-model M]`, writing one result per repeat to `<corpusRoot>/results/<timestamp>-probe-<runId>-<focus>-s<shard>-<arm>-r<k>.json` as `{tier: "probe", runId, focus, shard, arm, repeat, missIds, caught: string[], verdicts: RecallVerdict[], findings: number, readImpact: boolean | null, citesOutside: number, costUsd: number | null, judgeCostUsd: number | null}`; exported pure helpers `assembleSpecialistPrompt(input: { specialistsMd: string; focus: string; runDir: string; worktree: string; target: string; shard: { n: number; total: number } | null; brief: string | null; excludedFiles: boolean; impact: { path: string; inline: string } | null }): string`, `transcriptReadPath(streamJson: string, path: string): boolean`, `countOutsideCitations(findings: ReviewFinding[], impactMarkdown: string, shardFiles: string[]): number`; and in `replay-full.ts` results, a new `impactBytes: number | null` field (size of `impact.md`, null when absent)
**Touches:** skills/magpie/evals/quality/probe-specialist.ts (new) | skills/magpie/evals/quality/__tests__/probe-specialist.test.ts (test) | skills/magpie/evals/quality/replay-full.ts (edit) | skills/magpie/evals/quality/__tests__/replay-full.test.ts (test) | skills/magpie/evals/quality/README.md (edit)
**Builds:** D7
- [ ] Write `probe-specialist.test.ts` for the pure helpers, with expected values by hand: `assembleSpecialistPrompt` on a small hand-written specialists.md fixture string orders focus block, run header (sharded and unsharded forms), Output Contract, excluded-files block, brief and impact part exactly as `references/specialists.md` lists them; with `impact` set it inserts `Outside the diff: <path>` directly under the `Diff:` line and appends the `magpie-impact-part` block with `<top entries>` replaced by `inline`; with `impact` set and no such block in the input it throws naming `magpie-impact-part`; it throws naming the focus when the focus block is missing. `transcriptReadPath` is true for a stream-json line with a `tool_use` named `Read` whose `input.file_path` equals the path, and false for a `Bash` cat of it and for other paths. `countOutsideCitations` counts findings whose description cites a `file:line` that appears in the impact Markdown with a file outside `shardFiles` -> the suite fails on the missing module.
- [ ] Implement `probe-specialist.ts`. Per repeat: make a scratch run dir, copy the corpus run's files with `copyCorpusFiles`, `git worktree add --detach <scratch>/worktree <headRefOid>` in `--repo`, write the `log.jsonl` setup line as `replay-full.ts` does, run `bun bin/magpie.ts shard <scratch>`, pick the shard whose `files` contains `--file` (exit 1 naming the file if none does), run `bun bin/magpie.ts impact <scratch>` for the impact arm only, build the prompt from the live `references/specialists.md` (the brief from the corpus `brief.json` rendered as part 5 when present), run `claude -p --output-format stream-json --verbose --allowedTools Bash,Read,Grep,Glob,Write --max-budget-usd <cap> --add-dir <scratch>` in the worktree, read `findings/<focus>.shard-<n>.json` (or `findings/<focus>.json` unsharded), give each finding without an `id` the id `<focus>-s<n>-<i>` counting from 1, judge against the `--misses` subset with `judgeRecall`, write the result file, and remove the worktree with `worktreeRemoveCommand`. A missing findings file is recorded as `findings: 0, caught: []` with the reason, not an error -> the suite passes.
- [ ] In `replay-full.ts`, add `impactBytes` to the result from `<scratch>/impact.md`, with a test in `replay-full.test.ts` for the null and present cases at the function that builds diagnostics. Document the probe and its spend in `evals/quality/README.md` -> all three gates pass.
- [ ] Commit `feat(magpie): specialist probe for the impact map` -> `git show --stat HEAD` lists only the five Touches paths.

### Task 5: Phase A, base arm
**Contract:** Needs: the `probe-specialist.ts` CLI (Task 4) | Offers: 21 base-arm probe result files under `~/.magpie/corpus/results/`
**Touches:** ~/.magpie/corpus/results/ (new)
**Builds:** D7
- [ ] Run the base arm, `--repeats 3`, `--max-cost-usd 3`, for these seven pairs (corpus run, focus, `--file`, `--misses`): `pr-70-1790391863` security `packages/backend/src/api/crypto/lock-uuid-namespace.ts` `miss-1`; `pr-70-1790391863` security `packages/desktop/src-tauri/src/commands/video.rs` `miss-2`; `pr-70-1790391863` bugs `packages/backend/src/api/crypto/public-verify.ts` `miss-3`; `pr-50-1789099641` architecture `packages/desktop/src-tauri/src/core/ml/ocr_context/patterns.rs` `miss-1`; `pr-50-1789099641` architecture, the diff file whose path ends `generate-ocr-truncated-id-no-ax-scenario.ts` (or, if no diff file matches, `docs/specs/2026-09-09-full-journey-scenario-design.md`, saying which in the report) `miss-5`; `pr-50-1789099641` bugs `docs/specs/2026-09-09-full-journey-scenario-design.md` `miss-6`; `pr-50-1789099641` bugs `packages/desktop/src-tauri/src/core/capture/body/worker.rs` `miss-9` -> 21 result files exist, and the report lists caught per pair, findings per run and total cost. Stop and report if spend passes $30.

### Task 6: Flip: the map reaches specialists, the critic and stage 3
**Existing:** buildCriticPrompts and CRITIC_PLACEHOLDERS in scripts/critic.ts; runCriticPrompt in scripts/critic-cmd.ts.
**Contract:** Needs: `runImpact`, `readImpactMap` (Task 3); `renderImpactForCandidates` (Task 2) | Offers: `<<IMPACT>>` in `CRITIC_PLACEHOLDERS` and filled by `buildCriticPrompts` from a new input field `impact: ImpactMap | null`; the `magpie-impact-part` block in `references/specialists.md`
**Touches:** skills/magpie/references/specialists.md (edit) | skills/magpie/references/critic.md (edit) | skills/magpie/scripts/critic.ts (edit) | skills/magpie/scripts/critic-cmd.ts (edit) | skills/magpie/scripts/__tests__/critic.test.ts (test) | skills/magpie/scripts/__tests__/critic-cmd.test.ts (test) | skills/magpie/SKILL.md (edit) | skills/magpie/scripts/__tests__/skill-lint.test.ts (test) | skills/magpie/evals/rules.json (edit) | skills/magpie/README.md (edit)
**Builds:** D4, D5, D6, D8
**Flips:** specialists and the critic receive outside-diff facts, and stage 3 computes them, where before neither prompt carried anything outside the diff and no stage ran `magpie impact`
**Review:** changes every review's prompts; the measured behaviour
- [ ] Tests first: in `critic.test.ts`, a template missing `<<IMPACT>>` throws naming it, and `buildCriticPrompts` fills `<<IMPACT>>` with `renderImpactForCandidates` output per batch, with a hand-written expected batch prompt fragment; in `critic-cmd.test.ts`, a run dir with `impact.json` yields a prompt file containing a hand-written writer line, and one without yields `(none)` -> both fail.
- [ ] Add `<<IMPACT>>` to `CRITIC_PLACEHOLDERS` and the `impact` input to `buildCriticPrompts`; make `runCriticPrompt` pass `await readImpactMap(runDir)`. In `references/critic.md`, add to the `magpie-critic` block a `## Outside the diff` section holding `<<IMPACT>>`, placed after `## Repository review rules`, and append to "How to check each candidate" step 2 the sentence: "The Outside the diff section lists locations found by text search: treat them as leads to where a guard, caller or other writer may be, and read them before relying on them." Update the "six placeholders" wording in critic.md's intro to seven -> critic tests pass.
- [ ] In `references/specialists.md`: change the intro's "up to five parts" to "up to six parts"; append to part 2 the sentence "When `<RUN_DIR>/impact.md` exists, add the line `Outside the diff: <path>` directly under `Diff:`, where `<path>` is `<RUN_DIR>/impact.md` on an unsharded run, and `<RUN_DIR>/impact.shard-<n>.md` on a sharded run when that file exists. A shard with no impact file gets no line and no part 6: never the whole run's map." Add part 6 after part 5, "6. The impact map, when the header carries an `Outside the diff:` line, with the matching `.brief.md` file's content in place of `<top entries>`:", followed by the fenced block tagged `magpie-impact-part` holding exactly the D4 text from the spec. Change "Parts 1, 2, and 3 go every time" only if a lint test requires it, and say so -> `grep -c 'magpie-impact-part' references/specialists.md` prints 1 and `bun test scripts/__tests__/skill-lint.test.ts` passes.
- [ ] In `SKILL.md` stage 3, add before "Read `references/scout.md`" the sentence: "Run `magpie impact \"$RUN_DIR\"` first; re-run it on resume when `impact.json` is missing." In `skill-lint.test.ts:232` change `3500` to `3600` and add to the comment above it: "Raised from 3500 for the impact-map step in stage 3." (the user agreed this at the design stop). Add to `evals/rules.json` the rule `{"id": "impact-runs-before-the-scout", "states": "SKILL.md: 3. Context", "origin": "docs/specs/2026-10-30-magpie-impact-map.md", "cases": [], "unpinned": "No case starts at the context stage, so no run reaches magpie impact."}`. In `README.md`, add `magpie impact` to the command list and one line under stage 3 -> all three gates pass, including skill-lint and the rules manifest test.
- [ ] Commit `feat(magpie): give specialists and the critic the outside-diff map` -> `git show --stat HEAD` lists only the Touches paths.

### Task 7: Version bump
**Contract:** Needs: the flip commit (Task 6) | Offers: magpie version 0.16.0
**Touches:** skills/magpie/skill.json (edit) | skills/index.json (edit) | .claude-plugin/marketplace.json (edit)
**Builds:** none, release bookkeeping that delivers no decision
**Effort:** low, three version strings change from 0.15.1 to 0.16.0 as commit eccf3ad did, and the existing manifest tests check them
- [ ] Change magpie's version from `0.15.1` to `0.16.0` in the three Touches files, matching commit `eccf3ad` -> from the repo root, `bun test` passes.
- [ ] Commit `chore(magpie): 0.16.0` -> `git show --stat HEAD` lists only the three Touches paths.

### Task 8: Phase A, impact arm and the gate
**Contract:** Needs: the `probe-specialist.ts` CLI (Task 4); the `magpie-impact-part` block (Task 6); the base-arm results (Task 5) | Offers: 21 impact-arm probe result files and a phase A table in the run record with the gate verdict
**Touches:** ~/.magpie/corpus/results/ (new)
**Builds:** D7
- [ ] Run the impact arm with the same seven pairs, `--repeats 3` and `--max-cost-usd 3` as Task 5 -> 21 result files exist. Stop and report if the phase A total passes $60.
- [ ] Tabulate per pair and arm: caught count over repeats, findings per run, read rate, outside citations, cost. Apply the spec's bar: the gate passes when the impact arm's pooled (miss, repeat) catches exceed base by 3 or more and its read rate is above 0.5 -> the table and the verdict go to the controller, which writes them into the run record.

### Task 9: Phase B, full replay (only on the user's go-ahead after Task 8)
**Contract:** Needs: Task 8's gate verdict and the user's go-ahead; `replay-full.ts` with `impactBytes` (Task 4); the flip commit (Task 6) and its parent | Offers: 8 replay result files and a phase B table in the run record
**Touches:** ~/.magpie/corpus/results/ (new)
**Builds:** D7
- [ ] Before anything else, stop with `status.sh pause --reason` and put Task 8's table and the bar's verdict to the user. Nothing decides automatically (spec D7, D8 step 8): phase B runs only when the user reads phase A as a gain and says go. If they do not, report that phase B was not run -> the run record holds the user's answer.
- [ ] Base arm: `git worktree add --detach <scratchpad>/impact-base <flip commit>^`, `bun install` in its `skills/magpie`, and run `bun evals/quality/replay-full.ts --corpus <runId> --repo ~/Documents/projects/workings --max-cost-usd <cap>` from it twice per run, with caps 45 for `pr-50-1789099641` and 20 for `pr-70-1790391863`. Impact arm: the same from this worktree at HEAD -> 8 result files.
- [ ] Compare shard coverage within each pair. A run whose coverage differs from its pair is re-run once; if it differs again, report both and exclude the pair from the comparison. Stop and report if phase B spend passes $260 or the total passes $320 -> every compared pair has equal `shardCoverage` in its result files.
- [ ] Tabulate per arm: missed-recall c/n, outside-diff recall, kept count, label precision, cost, `impactBytes` -> the table goes into the run record, and the keep-or-revert decision goes to the user.
