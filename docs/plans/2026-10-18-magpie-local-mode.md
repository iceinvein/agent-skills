# Plan: magpie local mode

**Goal:** Let an implementing or orchestrating agent run magpie on its own branch diff,
in session and on its live tree, with no PR, no HTML server and no posting, and get the
findings back as a terminal handoff to address (spec:
`docs/specs/2026-10-18-magpie-local-mode.md`).

**Architecture:** Four inert tasks land first: the local diff and metadata (T1), the
review-root lookup with dedupe and critic reading through it (T2), the handoff command
(T3) and the mode-aware status ladder (T4). Nothing creates a local run until T5, the
flip, adds `setup --local` and the `target` and `handoff` subcommands. T6 rewrites the
prompts and SKILL.md for the new mode; T7 adds the eval case.

## Ground Rules

- All commands run from `skills/magpie` unless stated. Gates: `bun test`, `bun run lint`,
  `bunx -p typescript@5.9.3 tsc --noEmit`. All three must pass before a task reports done.
  (`bun run typecheck` calls a bare `tsc` that no package installs; do not add one.)
- Commit messages are Conventional Commits in the repo's style: `feat(magpie): ...`,
  `test(magpie): ...`, `fix(magpie): ...`, `docs(magpie): ...`. Written as the repo's git
  user only. No `Co-Authored-By` trailer, no "Generated with" footer, no session link, no
  em dashes.
- Match the file you are in: naming, error style (`{ok: true, ...} | {ok: false, error}`
  results in git helpers, `process.stderr.write('magpie: ...')` plus a numeric exit in
  commands), layout, and the `appendFile(log.jsonl)` logging shape with `ts: Date.now()`.
- No new dependencies. No `any`, `@ts-ignore` or `biome-ignore`. Fail loudly on malformed
  input, never default missing data. The one sanctioned fallback is a missing
  `target.json`, read as PR mode (runs that predate this change).
- Tests live in `scripts/__tests__/<module>.test.ts`, use real temp git repos where git is
  involved (the `sh` helper and `beforeEach` shape in `scripts/__tests__/setup-cmd.test.ts`),
  assert observable behaviour, and use hand-written expected values.
- The caller's repository is never written by local mode: no `git add`, no `git add -N`,
  no `git stash`, no `git fetch`, no files created in it.
- No em dashes in prose, comments or docs.
- Literal values: base default `origin/HEAD`; run id `local-<branch-slug>-<unix-ts>`, slug
  = branch with every run of characters outside `[A-Za-z0-9._-]` replaced by `-`,
  `detached` when HEAD has no branch; new stage name `handoff`; `diff-source.json`
  `source: "local"`.

### Task 1: Local branch diff and metadata
**Contract:** Needs: none | Offers: `localBranchDiff(input: {gitBin: string; repoPath: string; baseRef?: string}): Promise<{ok: true; diff: string; baseRef: string; mergeBase: string; head: string} | {ok: false; error: string}>`; `type LocalMeta = {branch: string | null; baseRef: string; mergeBase: string; head: string; dirty: boolean; author: string; commits: Array<{oid: string; headline: string; body: string}>; intentFile: string | null}`; `localBranchMeta(input: {gitBin: string; repoPath: string; baseRef: string; mergeBase: string; head: string; intentFile: string | null}): Promise<{ok: true; meta: LocalMeta} | {ok: false; error: string}>`; `diffSha256(diff: string): string` (lowercase hex sha256 of the UTF-8 bytes)
**Touches:** scripts/local-diff.ts (new) | scripts/__tests__/local-diff.test.ts (new)
**Effort:** low, the Contract and the git commands are spelled out below, the work is carrying them out
- [ ] Tests first, in a temp repo on `main` with a branch `feat/x` checked out that has one commit, one uncommitted edit to a tracked file, and one untracked file: `localBranchDiff({..., baseRef: 'main'})` returns a diff containing a `diff --git` section for each of the three files, the untracked one with `new file mode` and `+++ b/<name>`, and `mergeBase` equal to `main`'s SHA -> tests fail with the module missing.
- [ ] Tests: an unresolvable `baseRef: 'nope'` returns `ok: false` with an error naming `nope`; no `baseRef` and no `origin` remote returns `ok: false` naming `origin/HEAD`; a branch identical to its base with a clean tree returns `ok: false` with `nothing to review against main`; a gitignored untracked file is absent from the diff; after the call `git status --porcelain` and `git diff --cached` in the repo print exactly what they printed before. -> these fail before the code exists
- [ ] Implement: resolve `baseRef ?? 'origin/HEAD'` with `git rev-parse --verify --quiet <ref>^{commit}` (no fetch); `git merge-base <base> HEAD`; `git diff --no-color --find-renames <mergeBase>`; then for each path from `git ls-files --others --exclude-standard -z`, append `git diff --no-color --no-index -- /dev/null <path>` (exit 1 is that command's success code; any other non-zero exit is an error). `head` is `git rev-parse HEAD` -> tests pass.
- [ ] Tests for `localBranchMeta`: on the repo above it returns `branch: 'feat/x'`, `dirty: true`, `author` equal to `git config user.name`, one commit with its headline and body, `intentFile` passed through; on a detached HEAD `branch: null`; with `user.name` unset (`GIT_CONFIG_GLOBAL=/dev/null` and the repo config removed) `ok: false` naming `user.name`. `diffSha256('abc')` equals `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad` -> implement (`git symbolic-ref --short -q HEAD`, `git status --porcelain`, `git log --format=%H%x1f%s%x1f%b%x1e <mergeBase>..HEAD`, `node:crypto` `createHash`) -> pass.
- [ ] Gates pass, commit the two paths only -> report the SHA.

### Task 2: Review root lookup
**Contract:** Needs: none | Offers: `type ReviewTarget = {mode: 'pr' | 'local'; root: string}`; `readTarget(runDir: string): Promise<ReviewTarget>` (no `target.json`: `{mode: 'pr', root: join(runDir, 'worktree')}`; unparseable JSON, unknown `mode` or non-string `root`: throws an Error naming `target.json` and the problem); `writeTarget(runDir: string, target: ReviewTarget): Promise<void>` (writes `<runDir>/target.json`, two-space JSON plus newline); `reviewRoot(runDir: string): Promise<string>` (= `(await readTarget(runDir)).root`)
**Touches:** scripts/target.ts (new) | scripts/__tests__/target.test.ts (new) | scripts/dedupe-cmd.ts (edit) | scripts/critic-cmd.ts (edit) | scripts/__tests__/dedupe-cmd.test.ts (test) | scripts/__tests__/critic-cmd.test.ts (test)
- [ ] Tests first for `target.ts`: missing file gives the PR default; a written `{mode: 'local', root: '/x'}` reads back; `{mode: 'other'}` and `not json` each throw with `target.json` in the message -> fail, implement, pass.
- [ ] `dedupe-cmd.ts:127` passes `await reviewRoot(runDir)` to `verifyEvidence` instead of `join(runDir, 'worktree')`; `critic-cmd.ts:87` sets `worktree: await reviewRoot(runDir)`. Add one test to each command's existing test file: with `target.json` naming a directory outside the run dir that holds the anchored file, dedupe keeps the finding (and drops it as `hallucinated-file` when the file is absent there), and the critic prompt contains that directory as `<<WORKTREE>>`. Create `dedupe-cmd.test.ts` if it does not exist -> existing tests still pass, new ones pass.
- [ ] Gates pass, commit the Touches paths only -> report the SHA.

### Task 3: Handoff command
**Contract:** Needs: `readTarget` from Task 2; `localBranchDiff`, `diffSha256` from Task 1 | Offers: `formatHandoff(input: {target: string; runDir: string; findings: ReviewFinding[]; stale: boolean}): string`; `runHandoff(runDir: string, opts?: {gitBin?: string}): Promise<number>` (writes `formatHandoff` output to stdout, appends `{stage: 'handoff', status: 'done', findings: <count>}` to `log.jsonl`, returns 0; returns 2 with a `magpie: handoff ...` stderr line when the run is not local, and 4 when `findings.final.json` or `local.json` is missing)
**Touches:** scripts/handoff-cmd.ts (new) | scripts/__tests__/handoff-cmd.test.ts (new)
- [ ] Tests first for `formatHandoff` with three hand-built findings (one `must-fix` score high, one `should-fix`, one `consider`) and hand-written expected substrings: header line `# magpie local review: <target>`; a counts line `1 must-fix, 1 should-fix, 1 optional` (consider and optional are counted together as optional); the run dir path; actionable findings numbered in `rankActionable(findings, {}, new Map(), findings.length)` order (`scripts/render-issues-list.ts`), then the `isSuggestion` findings in file order; each item headed `N. [<risk.action>] <file>:<line>: <title>` (`<file>` alone when `line` is null); the body from `formatFindingDescriptionMarkdown` (`scripts/finding-description.ts`); a fenced code block holding `suggestion.body` when present; the footer `Address every must-fix and should-fix, or say why not. The rest are optional.`; when `stale` is true, a line `Warning: the tree changed since this review began; line anchors may be off.` directly after the header, and no such line when false. Zero findings prints the header and `No findings.` and no footer. -> fail with the module missing
- [ ] Tests for `runHandoff`: a run dir with `target.json` mode `local` rooted at a temp repo, `local.json`, `findings.final.json` and `diff-source.json` holding the `diffSha256` of that repo's current local diff prints a non-stale handoff and logs the `handoff` entry; editing a file in the repo afterwards makes the next call print the warning; a PR-mode run dir returns 2; missing `findings.final.json` returns 4. The target string is `local branch <branch> against <baseRef>` from `local.json` (`detached HEAD` for a null branch). -> fail before the code exists
- [ ] Implement. Staleness recomputes `localBranchDiff({gitBin, repoPath: target.root, baseRef: meta.baseRef})` and compares `diffSha256` with `diff-source.json`'s `diffSha256`; a failed recompute is reported as stale, never as fresh -> tests pass.
- [ ] Gates pass, commit the two paths only -> report the SHA.

### Task 4: Mode-aware status ladder
**Contract:** Needs: `readTarget` from Task 2 | Offers: `LOCAL_ORDER` exported from `scripts/status-cmd.ts` = `['setup', 'context', 'specialists', 'dedupe', 'critic', 'peer-review', 'handoff']`; `runStatus(runDir)` uses `LOCAL_ORDER` when `readTarget(runDir)` says `local` and `ORDER` otherwise; `StatusResult['lastCompleted']` and `next` widen to include `'handoff'`
**Touches:** scripts/status-cmd.ts (edit) | scripts/__tests__/status-cmd.test.ts (test) | scripts/__tests__/skill-lint.test.ts (test)
**Effort:** low, the two ladders are given literally and the existing test file shows the shape
- [ ] Tests first: a local run whose log ends at `peer-review done` reports `next: 'handoff'`; one ending at `handoff done` reports `lastCompleted: 'handoff', next: 'cleanup'`; a PR run (no `target.json`) ending at `peer-review done` still reports `next: 'report'` -> the local cases fail, implement, pass.
- [ ] Check the skill-lint test that asserts diagnostic stage names stay out of `ORDER` still passes and, if it reads `ORDER` only, extend its assertion to `LOCAL_ORDER` -> gates pass.
- [ ] Commit the Touches paths only -> report the SHA.

### Task 5: `setup --local` and the new subcommands
**Contract:** Needs: `localBranchDiff`, `localBranchMeta`, `diffSha256` from Task 1; `writeTarget`, `reviewRoot` from Task 2; `runHandoff` from Task 3 | Offers: CLI `magpie setup <run-dir> --local [--base <ref>] [--intent-file <path>] [--repo <path>]`; CLI `magpie target <run-dir>` (prints the review root and a newline, exit 0); CLI `magpie handoff <run-dir>` (exit code from `runHandoff`); `RunSetupInput` becomes `{runDir: string; repoPath: string; deps?: Deps} & ({mode: 'pr'; prNumber: number} | {mode: 'local'; baseRef?: string; intentFile?: string})`; PR-mode setup also writes `target.json` `{mode: 'pr', root: <runDir>/worktree}`; local setup writes `diff.patch`, `diff-source.json` `{source: 'local', mergeBase, baseRef, head, diffSha256}`, `local.json` (`LocalMeta`), `target.json` `{mode: 'local', root: <absolute repoPath>}`, and no `pr.json`, `incremental.json` or `worktree`
**Touches:** scripts/setup-cmd.ts (edit) | bin/magpie.ts (edit) | scripts/__tests__/setup-cmd.test.ts (test) | scripts/__tests__/cleanup-cmd.test.ts (test)
**Flips:** magpie can now create a review run with no PR: `setup` gains `--local` (previously `--pr` was required), and `target` and `handoff` become subcommands
**Review:** the flip, and cleanup safety on the caller's live tree
- [ ] Tests first in `setup-cmd.test.ts`, reusing its temp repo: on branch `feature-x` with one commit, an uncommitted edit and an untracked file, `runSetup({mode: 'local', runDir, repoPath: repo, baseRef: 'main'})` returns 0 and writes the five files above with hand-checked values (`source: 'local'`, `target.json` root equal to `repo`, `local.json` branch `feature-x`), no `pr.json` and no `worktree` dir; `--base nope` returns a non-zero exit, keeps `log.jsonl` with a `{stage: 'local-diff', status: 'error'}` entry and removes the other files (the existing `cleanup()` list gains `local.json` and `target.json`); `intentFile` pointing at a missing path returns non-zero naming the path. Existing PR tests now pass `mode: 'pr'` and additionally assert `target.json`. -> the local cases fail before the code exists
- [ ] Test in `cleanup-cmd.test.ts`: after a local setup, `runCleanup` archives the run dir and the repo still has its uncommitted edit, its untracked file, and `git worktree list` shows one entry. -> fails before the local path exists
- [ ] Implement in `runSetup`: after preflight, branch on `mode`. Local: `localBranchDiff`, write `diff.patch`, `localBranchMeta` with the absolute `intentFile` (checked with `existsSync`), write the sidecars, log `{stage: 'local-diff', status: 'done', mergeBase, baseRef}`, then the shared `applyPathFilter`, `runShard`, `runTestsCheck`, and log `{stage: 'setup', status: 'done', root: <repoPath>}`. Skip `detectIncrementalReview` and `createWorktree`. Preflight still requires `gh`: leave that as is and say so in the commit body, since relaxing it changes `preflight.ts` for both modes. -> the Task 5 tests pass
- [ ] `bin/magpie.ts`: `setup` accepts exactly one of `--pr <n>` / `--local` (both or neither: `setup: pass exactly one of --pr <n> or --local` on stderr, exit 2); parse `--base` and `--intent-file`; add `target` and `handoff` handlers that error with `<cmd>: missing <run-dir>` and exit 2 when the arg is absent; add both to `USAGE` -> `bun bin/magpie.ts setup /tmp/x` exits 2 with that message; gates pass.
- [ ] Commit the Touches paths only -> report the SHA.

### Task 6: Prompts, SKILL.md and docs
**Contract:** Needs: the Task 5 CLI (`setup --local`, `target`, `handoff`); `LOCAL_ORDER` from Task 4 | Offers: magpie skill version `0.14.0`; SKILL.md "Local mode" section and the updated trigger description; placeholders `<WORKTREE>` and `<TARGET>` in `references/specialists.md`, `<<WORKTREE>>` and `<<TARGET>>` in `references/scout.md` and `references/checks.md`
**Touches:** SKILL.md (edit) | references/scout.md (edit) | references/checks.md (edit) | references/specialists.md (edit) | references/peer-review.md (edit) | README.md (edit) | skill.json (edit) | ../../README.md (edit)
- [ ] `references/specialists.md`: `Working directory: <RUN_DIR>/worktree` becomes `Working directory: <WORKTREE>` and `You are reviewing PR #<PR_NUMBER>.` becomes `You are reviewing <TARGET>.`; the substitution paragraph (line ~71) lists `<WORKTREE>` (`magpie target "$RUN_DIR"`) and `<TARGET>` (`PR #<n>` or `local branch <branch> against <baseRef>`) in place of `<PR_NUMBER>`. `scout.md` and `checks.md` get the same with their `<<...>>` style, and `scout.md` gains one paragraph: on a local run there is no `pr.json`; intent evidence is `<<RUN_DIR>>/local.json` (`commits[].headline` and `body`) and the file named by its `intentFile` when non-null, read in place of `title`, `body` and issue links -> `grep -n 'RUN_DIR>/worktree\|<<RUN_DIR>>/worktree\|PR #<PR_NUMBER>\|PR #<<PR_NUMBER>>' references/*.md` prints nothing.
- [ ] `references/peer-review.md`: a "Local runs" substitution list: `<<PR_TITLE>>` = `Local branch <branch>`, `<<PR_AUTHOR>>` = `jq -r .author < $RUN_DIR/local.json`, `<<PR_HEAD_BRANCH>>` = `jq -r '.branch // "detached HEAD"'`, `<<PR_BASE_BRANCH>>` = `jq -r .baseRef`. -> each `jq` expression prints the expected value against a local run's `local.json`
- [ ] SKILL.md: frontmatter `description` adds self-review of the current branch diff before a PR, typically requested by an implementing or orchestrating agent, with findings handed back in the terminal. Step 0 branches: a request with no PR that asks to review the current branch or work in progress is local mode; run id per Ground Rules; resume matches `local-<branch-slug>-*`. New `## Local mode` section after the walkthrough, listing deltas only: setup command with flags (`--intent-file` when the caller has a spec or plan); `WORKTREE=$(magpie target "$RUN_DIR")` and `TARGET` values used in every prompt; skip stage 2 and every `magpie render`; stages 3 to 7 as written; stage 8 is `magpie handoff "$RUN_DIR"`, whose stdout is relayed verbatim as the reply to the caller; then `magpie cleanup "$RUN_DIR" --repo "$REPO"` at once; end the turn. Two rules: do not edit the tree while the run is in flight; the pipeline needs the Agent tool, so a session that cannot dispatch subagents stops and says so rather than reviewing single-handed. Existing stage text that says `$RUN_DIR/worktree` refers to `$WORKTREE` instead. -> `grep -n 'Local mode' SKILL.md` finds the section and `grep -n 'RUN_DIR/worktree' SKILL.md` prints nothing
- [ ] `README.md` (skill) and the root `README.md` magpie row each gain one sentence on local mode; `skill.json` `description` gains the same trigger clause -> every claim matches the code as Task 5 shipped it (`bun bin/magpie.ts --help` lists `target` and `handoff`); gates pass.
- [ ] From the repo root: `bun run src/cli/index.ts bump magpie minor` -> `skill.json` version reads `0.14.0`.
- [ ] Commit the Touches paths only -> report the SHA.

### Task 7: Eval case
**Contract:** Needs: SKILL.md "Local mode" from Task 6; the Task 5 CLI | Offers: eval case `evals/local-mode-hands-back/` (`case.yaml`, `fixture.sh`, `prompt.md`, `graders/`), a row in `evals/README.md`
**Touches:** evals/local-mode-hands-back/case.yaml (new) | evals/local-mode-hands-back/fixture.sh (new) | evals/local-mode-hands-back/prompt.md (new) | evals/local-mode-hands-back/graders/ (new) | evals/README.md (edit)
- [ ] Model the case on `evals/report-ends-the-turn/` (read all its files first). The fixture scaffolds a local run at peer-review done: a temp git repo with a branch diff, a run dir with `target.json` (local), `local.json`, `diff-source.json`, `findings.final.json` holding two findings, and a log through `peer-review done`. The prompt resumes it. Graders pin: `magpie handoff` was run; no `magpie serve`, `magpie render`, `magpie post` or `gh` call; `magpie cleanup` was run after handoff; the final message lists both finding titles. -> `bash evals/local-mode-hands-back/fixture.sh` into a temp dir exits 0 and `magpie status` on the scaffolded run prints `next: handoff`
- [ ] `evals/README.md` table gains the row and the case count in its first line goes from five to six. -> the row names the case and what it pins
- [ ] Run the case once: `claude plugin eval skills/magpie --scaffold --allow-tools Bash Write Edit --runs 1 --ablation none` filtered to this case if the CLI allows, else the full suite -> report pass or fail with the output path.
- [ ] Gates pass, commit the Touches paths only -> report the SHA.
