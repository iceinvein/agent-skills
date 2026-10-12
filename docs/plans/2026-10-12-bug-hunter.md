# Plan: bug-hunter

**Goal:** a `bug-hunter` skill that proves logic bugs with failing repros against
stated intent, plus a historical benchmark (mined from workings and snowvault)
that measures it against a no-skill baseline. Design:
`docs/specs/2026-10-12-bug-hunter.md`.

**Architecture:** two trees.
- `~/Documents/projects/bug-hunter` (the harness, a new git repo, Bun +
  TypeScript): mine → introduce → classify → build case → workspace → grade →
  run → report. Each stage is a module under `src/` and a subcommand of
  `src/cli.ts`, and writes JSONL under `cases/` or `results/`.
- `agent-skills/skills/bug-hunter` (the skill): `SKILL.md`, references,
  `skill.json` and `claude plugin eval` cases.

The harness reads the skill from the agent-skills tree by path. Nothing else is
shared between the two trees.

## Ground Rules

- Commit messages: `type(scope): subject` in the imperative, lowercase subject,
  no trailing period, and a body that says why. Scope is `bug-hunter` in
  agent-skills; in the harness repo it is the module name (`mine`, `grade`, ...).
  No `Co-Authored-By`, no "Generated with" footer, no em dashes.
- Runtime: Bun (whatever `bun --version` reports), TypeScript strict. **No new
  dependencies** in either tree; use `node:` built-ins and `Bun.spawn`.
- Tests: `bun test`. Git behaviour is tested against real throwaway repos built
  in a temp dir by `tests/helpers/fixture-repo.ts`, never against mocks of git.
  Expected values are written by hand.
- `~/Documents/projects/workings` and `~/Documents/projects/snowvault` are
  **read-only**: no checkout, branch, tag, ref, stash or config write in either.
  Only `log`, `show`, `blame`, `rev-list`, `cat-file`, and being the source of
  a clone or fetch.
- Model id for every `claude -p` call: `claude-opus-5-5`, read from
  `config/harness.json` (`"model"`), not inlined.
- Missing config or malformed model output throws with the offending value in
  the message. No defaults are invented for missing data.
- Fresh-case window: an introducing commit at most **20** commits before the
  fix (`config/harness.json` `"freshWindow": 20`).
- Pilot size: **20** cases, 10 per repo (`"pilotSize": 20`).
- Scopes dropped at mining: `ci`, `deps`, `docs`, `infra`, `scripts`, `dev`,
  `tooling`, `agents`, `release`.
- Snowvault DB-tier cases never run concurrently (its `CLAUDE.md`: worktrees
  share one database).

### Task 1: Harness repo and the fix-commit miner
**Contract:** Needs: none | Offers: `type Candidate = { repo: string; sha: string; parent: string; subject: string; body: string; scope: string | null; srcFiles: string[]; testFiles: string[] }`; `mineFixCommits(repoPath: string, repoName: string): Promise<Candidate[]>`; `git(repoPath: string, args: string[]): Promise<string>` (throws on non-zero exit, with stderr); `makeFixtureRepo(commits: { message: string; files: Record<string, string | null> }[]): Promise<{ path: string; shas: string[] }>` (test helper; `null` deletes a file)
**Touches:** bug-hunter/package.json (new) | bug-hunter/tsconfig.json (new) | bug-hunter/.gitignore (new) | bug-hunter/config/harness.json (new) | bug-hunter/src/git.ts (new) | bug-hunter/src/mine.ts (new) | bug-hunter/src/cli.ts (new) | bug-hunter/tests/helpers/fixture-repo.ts (new) | bug-hunter/tests/mine.test.ts (test)
**Effort:** low, the filter rules are fully specified below and the tests are hand-written from them
- [ ] `git init` in `~/Documents/projects/bug-hunter`; `package.json` with `"type": "module"` and scripts `test` and `cli` (`bun run src/cli.ts`); `.gitignore` covers `node_modules`, `workspaces/`, `results/` -> `git status` shows only the new files
- [ ] `config/harness.json`: `{ "model": "claude-opus-5-5", "freshWindow": 20, "pilotSize": 20, "droppedScopes": ["ci","deps","docs","infra","scripts","dev","tooling","agents","release"], "repos": {} }` -> file parses with `bun -e`
- [ ] `mineFixCommits` keeps a non-merge commit when all of these hold: the subject matches `^fix(\(([^)]+)\))?!?: `; the body has a non-blank line other than `Ref:` lines; at least one changed file is a test (path matches `/(^|\/)(tests?|__tests__)\/|[._-](test|spec)\.|_test\.go$/`); at least one non-test file has a source extension `.ts .tsx .js .mjs .rs .go .py .sql`; scope not in `droppedScopes` -> `tests/mine.test.ts` builds a fixture repo with one commit per rule (kept, wrong prefix, empty body, Ref-only body, no test, test-only, dropped scope) and asserts exactly the kept shas come back, with `scope`, `srcFiles` and `testFiles` as written by hand
- [ ] `src/cli.ts mine --repo <path> --name <name>` writes `cases/candidates-<name>.jsonl` -> run against workings and snowvault; line counts land within 10% of the survey (510 and 130 before scope filtering, so lower after) and are recorded in the commit body

### Task 2: Introducing commit and case kind
**Contract:** Needs: `git(repoPath: string, args: string[]): Promise<string>`; `makeFixtureRepo(...)` from Task 1 | Offers: `type Intro = { sha: string; lines: number; distance: number }`; `findIntroducingCommits(repoPath: string, fixSha: string, srcFiles: string[]): Promise<Intro[]>` (sorted by `lines` desc); `caseKind(intros: Intro[], freshWindow: number): "fresh" | "latent"`
**Touches:** bug-hunter/src/introduce.ts (new) | bug-hunter/tests/introduce.test.ts (test)
- [ ] For each src file, parse `git diff -U0 <fix>^ <fix>` hunk headers on the **old** side (`-a,b`); blame `a..a+b-1` at `<fix>^`. For a pure-addition hunk (`b == 0`), blame line `a` (the line the insertion follows) when `a > 0`. `distance` = `git rev-list --count <intro>..<fix>` -> fixture: commit A writes `f(x)` with a `<` boundary, B unrelated, C fixes it to `<=`; asserts `[{ sha: A, lines: 1, distance: 2 }]`
- [ ] Pure-addition fixture: the fix inserts a guard after line 3 of a file last touched by commit A -> asserts A is returned
- [ ] `caseKind` is `fresh` when the top intro's `distance <= freshWindow`, otherwise `latent`; an empty intros list throws -> unit tests at distance 20 (fresh), 21 (latent), and `[]` (throws)

### Task 3: Classifier over `claude -p`
**Contract:** Needs: `type Candidate` from Task 1 | Offers: `type Label = { label: "logic" | "cosmetic" | "infra"; wrongVsRight: string }`; `claudePrint(prompt: string, opts: { model: string; cwd?: string }): Promise<string>` (runs `claude -p --output-format json --model <model>`, returns the `result` field, throws on non-zero exit or a missing `result`); `parseLabel(raw: string): Label` (throws on anything but the exact JSON shape); `classify(c: Candidate, diffStat: string, model: string): Promise<Label>`
**Touches:** bug-hunter/src/claude.ts (new) | bug-hunter/src/classify.ts (new) | bug-hunter/prompts/classify.md (new) | bug-hunter/tests/classify.test.ts (test)
**Review:** the prompt decides which bugs enter the benchmark; a stat cannot confirm it sorts correctly
- [ ] `prompts/classify.md`: defines `logic` (code computed, decided or sequenced the wrong thing; an observable wrong result), `cosmetic` (copy, layout, styling, wording only), `infra` (build, CI, deps, setup, tooling); asks for exactly `{"label": ..., "wrongVsRight": "<was X; now Y, one sentence>"}` -> file exists, under 60 lines
- [ ] `parseLabel` accepts the JSON optionally inside a ```json fence and rejects any other label, extra keys or an empty `wrongVsRight` -> tests with hand-written strings: valid, fenced, `"label":"bug"`, missing key, extra key
- [ ] `src/cli.ts classify --name <name>` reads `cases/candidates-<name>.jsonl`, writes `cases/labelled-<name>.jsonl` (the candidate plus its `Label`), and resumes by skipping shas already written -> run on the first 10 workings candidates; read all 10 labels by hand and record the agreement count in the commit body

### Task 4: Case specs, repo config and pilot selection
**Contract:** Needs: `type Candidate`; `type Intro`; `caseKind(...)`; `type Label` | Offers: `type RepoConfig = { path: string; setup: string[]; packages: { dir: string; lang: "ts" | "rust" | "go"; test: string; dbTier: boolean }[] }` (`test` holds a `{files}` placeholder); `type CaseSpec = { id: string; repo: string; kind: "fresh" | "latent"; huntSha: string; fixSha: string; fixParent: string; scope: { diff: string } | { paths: string[] }; intentSources: string[]; testCmd: string; fixTests: string[]; lang: "ts" | "rust" | "go"; dbTier: boolean; answerKey: { subject: string; body: string; wrongVsRight: string } }`; `buildCase(c: Candidate & Label, intros: Intro[], cfg: RepoConfig, freshWindow: number): CaseSpec | { dropped: string }`; `selectPilot(cases: CaseSpec[], size: number): CaseSpec[]`
**Touches:** bug-hunter/src/case.ts (new) | bug-hunter/config/harness.json (edit) | bug-hunter/tests/case.test.ts (test)
- [ ] `config/harness.json` `repos`: an entry each for workings and snowvault, filled from each repo's `package.json`, `Taskfile.yml`, `Cargo.toml`, `go.mod` and `CLAUDE.md` (e.g. workings `packages/backend` → `bun test {files}`; snowvault Go → `go test {files}` on package dirs). Mark snowvault DB-tier packages `dbTier: true` per its `CLAUDE.md` -> every package dir named exists at workings/snowvault HEAD (`test -d`)
- [ ] `buildCase`: fresh → `huntSha` = intro sha, `scope.diff` = `<intro>^..<intro>`, `intentSources` = [intro commit message, `docs/specs/*` present at intro]. Latent → `huntSha` = fix parent, `scope.paths` = deepest common package dir of `srcFiles`, `intentSources` = [`docs/specs/*`, package `README`/`CLAUDE.md` present at hunt sha]. `fixTests` = `testFiles`; `testCmd` from the package owning the first test file. Drops with a reason when the label is not `logic` or no package owns the test file -> tests: one fresh, one latent, one cosmetic (dropped), one unowned path (dropped), each expected object written by hand
- [ ] `selectPilot` takes `size/2` per repo, balancing `lang` and `kind` round-robin, deterministic (sorted by `fixSha`), preferring `dbTier: false` -> test over 30 synthetic specs asserts the exact ids chosen
- [ ] `src/cli.ts cases` runs introduce + buildCase over the labelled files, writes `cases/all.jsonl`, `cases/dropped.jsonl` and `cases/pilot.jsonl` -> `pilot.jsonl` has 20 lines, 10 per repo

### Task 5: Leak-free workspaces
**Contract:** Needs: `git(...)`; `type RepoConfig` | Offers: `makeWorkspace(repoPath: string, sha: string, dest: string, setup: string[]): Promise<void>` (dest holds a repo whose object store contains `sha` and its ancestors only, checked out at `sha`, with `setup` commands run in it)
**Touches:** bug-hunter/src/workspace.ts (new) | bug-hunter/tests/workspace.test.ts (test)
**Review:** leakage invalidates the whole benchmark; this is the boundary that prevents it
- [ ] Build by `git init dest` then `git fetch --no-tags <repoPath> <sha>` and `git checkout --detach FETCH_HEAD`; no ref in the source repo is touched -> fixture repo with commits A→B→C, workspace at B: `git cat-file -e C` fails in dest, `git log --all --format=%H` is exactly [B, A], and `git for-each-ref` in the source is unchanged before and after
- [ ] If the fetch-by-sha is refused, fail with the git error rather than falling back to a full clone -> covered by the test above passing; a fallback branch does not exist in the code
- [ ] `setup` commands run in dest; the first failure throws with the command and its stderr -> test with `setup: ["false"]` asserts the throw

### Task 6: Grader and self-check
**Contract:** Needs: `makeWorkspace(...)`; `type CaseSpec` | Offers: `type Repro = { files: Record<string, string>; cmd: string }`; `gradeRepro(spec: CaseSpec, repro: Repro, workRoot: string): Promise<"proven" | "not-found" | "inapplicable">`; `selfCheckRepro(spec: CaseSpec): Promise<Repro>` (the fix commit's own `fixTests` at `fixSha`, with `testCmd`)
**Touches:** bug-hunter/src/grade.ts (new) | bug-hunter/tests/grade.test.ts (test)
- [ ] `gradeRepro` writes `repro.files` into a workspace at `fixParent` and runs `cmd`, then does the same at `fixSha`. Results: fails then passes → `proven`; a file path whose parent dir is missing, or a compile/collect error (the runner's own exit code for "no tests" or "build failed", recorded per package in config) → `inapplicable`; anything else → `not-found` -> fixture repo with a buggy `add` and its fix commit: a repro asserting the right sum is `proven`, a repro asserting the buggy sum is `not-found`, a repro importing a missing module is `inapplicable`
- [ ] `src/cli.ts selfcheck` grades `selfCheckRepro` for every pilot case, writes the outcome to `cases/selfcheck.jsonl`, and moves any case not `proven` into `cases/dropped.jsonl` with the outcome as its reason -> every remaining pilot case selfchecks `proven`; drop count recorded in the commit body

### Task 7: The skill, unregistered
**Contract:** Needs: none | Offers: the skill at `agent-skills/skills/bug-hunter/` with output `.bug-hunter/<YYYY-MM-DD>-<slug>/{report.md,findings.json}`; `findings.json` = `{ "target": string, "intent": { "id": string, "claim": string, "source": string }[], "bugs": { "id": string, "scenario": string, "claim": string, "expected": string, "observed": string, "repro": { "files": Record<string,string>, "cmd": string } }[], "ambiguities": { "id": string, "scenario": string, "question": string }[], "covered": { "scenario": string, "claim": string }[] }`
**Touches:** agent-skills/skills/bug-hunter/SKILL.md (new) | agent-skills/skills/bug-hunter/skill.json (new) | agent-skills/skills/bug-hunter/references/scenario-catalog.md (new) | agent-skills/skills/bug-hunter/references/findings-format.md (new) | agent-skills/skills/bug-hunter/references/roles.md (new)
- [ ] `SKILL.md` (under 150 lines): frontmatter description triggers on hunting bugs, edge cases, "what will QA find", or proving a change correct. Body states: input (a target diff/paths plus intent sources); the three roles in order (scenario author, executor, refuter) as dispatches; "no repro, no finding"; hunting happens in a scratch `git worktree`, the caller's tree is never modified; output location and the three buckets; the single-agent fallback (write `scenarios.md` before opening any changed body) -> line count and each named item present on read-through
- [ ] `references/roles.md`: the brief for each role. The scenario author is given intent sources, changed signatures/exports, callers and existing tests, and is told not to open changed bodies. The executor uses the repo's own test runner, found from manifests and `CLAUDE.md`/`AGENTS.md`. The refuter re-runs each repro clean and checks the expected value follows from a cited claim, or demotes it to an ambiguity -> each brief names its inputs and outputs
- [ ] `references/scenario-catalog.md`: the eight categories from the design, each with 3-6 concrete probes -> eight sections
- [ ] `references/findings-format.md`: the `findings.json` shape above verbatim and the `report.md` layout -> shape matches the Contract character for character
- [ ] `skill.json` modelled on `skills/sluice/skill.json`: `"type": "prompt"`, `"version": "0.1.0"`, `bundle.include: ["references"]`, no activation hooks -> `bun -e` parses it; `skills/index.json` unchanged

### Task 8: Behaviour evals
**Contract:** Needs: the skill and `findings.json` shape from Task 7 | Offers: none
**Touches:** agent-skills/skills/bug-hunter/evals/README.md (new) | agent-skills/skills/bug-hunter/evals/proves-a-spec-boundary-bug/ (new) | agent-skills/skills/bug-hunter/evals/silent-spec-is-an-ambiguity/ (new) | agent-skills/skills/bug-hunter/evals/correct-code-has-no-bugs/ (new) | agent-skills/skills/bug-hunter/evals/callers-tree-unchanged/ (new) | agent-skills/skills/bug-hunter/evals/scenarios-before-bodies/ (new)
- [ ] Each case dir holds `case.yaml`, `fixture.sh`, `prompt.md` and `graders/` in the format of `skills/sluice/evals/deep-plan-asks-the-fork/`. The fixtures are small Node repos with a `SPEC.md`: an off-by-one at a stated limit; a limit the spec never mentions; a correct implementation; any; any -> `ls` shows the four parts in each case
- [ ] Graders, one behaviour each: the bug case passes when `findings.json` has a bug whose `claim` cites the limit and whose repro fails in the fixture (`llm` + file grader); the ambiguity case passes when the bucket is `ambiguities` and `bugs` is empty; the correct case passes when `bugs` is empty; the tree case passes when `git status --porcelain` outside `.bug-hunter/` is empty; the order case is a regex over the trace showing `scenarios.md` written before any `Read` of the changed source file -> graders written
- [ ] Run `claude plugin eval skills/bug-hunter --scaffold --allow-tools Bash Write Edit --model claude-opus-5-5 --judge-model claude-opus-5-5 --runs 1 --ablation none` -> results pasted into `evals/README.md` as the first baseline, failures included and named

### Task 9: Runner, leak audit, judge and report
**Contract:** Needs: `makeWorkspace(...)`; `gradeRepro(...)`; `claudePrint(...)`; `type CaseSpec`; the `findings.json` shape from Task 7 | Offers: `runArm(spec: CaseSpec, arm: "skill" | "baseline", runDir: string): Promise<ArmResult>`; `type ArmResult = { caseId: string; arm: string; valid: boolean; leaks: string[]; outcome: "proven" | "judged" | "missed"; extraFindings: number; ambiguities: number; costUsd: number; seconds: number }`; `auditTrace(traceJsonl: string, workspace: string): string[]`; `writeReport(runDir: string): Promise<void>`
**Touches:** bug-hunter/src/run.ts (new) | bug-hunter/src/audit.ts (new) | bug-hunter/src/report.ts (new) | bug-hunter/prompts/hunt-skill.md (new) | bug-hunter/prompts/hunt-baseline.md (new) | bug-hunter/prompts/judge.md (new) | bug-hunter/tests/audit.test.ts (test) | bug-hunter/tests/report.test.ts (test)
**Review:** the leak audit and the judge decide what the numbers mean
- [ ] `runArm` makes a workspace at `huntSha`. For the skill arm only, it copies `agent-skills/skills/bug-hunter` into `<ws>/.claude/skills/bug-hunter`. It runs `claude -p --output-format stream-json --verbose --model <model>` in the workspace with the arm's prompt (scope + intent sources; both arms ask for the same `findings.json`), saves the trace, and reads `total_cost_usd` and the duration from the final result line -> exercised by the pilot smoke step below
- [ ] `auditTrace` returns every absolute path in a `Read`/`Glob`/`Grep` input, or a `Bash` command, that resolves outside the workspace (`/tmp` and the scratchpad allowed); any hit sets `valid: false` -> tests over hand-written trace lines: an inside read (no leak), `../workings/x` (leak), `cat ~/Documents/projects/snowvault/y` (leak)
- [ ] Outcome: any bug whose repro grades `proven` → `proven`. Otherwise, any bug whose repro is `inapplicable` and which the judge (`prompts/judge.md`, comparing the finding to `answerKey`, exact `{"match": true|false, "why": ...}`) matches → `judged`. Otherwise `missed`. Bugs not matched go to `<runDir>/triage.jsonl` with an empty `verdict` field, and `extraFindings` counts them -> exercised by the smoke step
- [ ] `writeReport` aggregates `<runDir>/*/*.json` into `report.md`: per arm, recall (proven, proven+judged), invalid runs, extra findings, triaged precision (`real / (real + not-a-bug)` over `triage.jsonl` rows with a verdict, else "untriaged"), ambiguities, mean cost and seconds; latent recall is footnoted as scope-narrowed -> test over three hand-written ArmResults and a triage file asserts the exact table text
- [ ] `src/cli.ts run --cases cases/pilot.jsonl --arms skill,baseline [--only <id>]` serialises `dbTier` cases and runs the rest up to 4 at a time. Smoke: `--only` one fresh workings case, both arms -> two ArmResult files, `valid: true`, and a `report.md` rendered

### Task 10: Register the skill
**Contract:** Needs: the skill from Task 7; the evals from Task 8 | Offers: none
**Touches:** agent-skills/skills/index.json (edit) | agent-skills/README.md (edit)
**Flips:** `bug-hunter` goes from present on disk but absent from the index (not installable through the CLI) to listed and installable
- [ ] `bun run build:index` -> `skills/index.json` gains exactly one entry, `bug-hunter`, and no other diff
- [ ] README: one row in a fitting section (the skill table under Code Architecture, or a new "Verification" section if none fits), in the existing row format -> `bun test` green in agent-skills

## Not in this plan

- The 20-case pilot run of both arms: about 40 agent runs on `claude-opus-5-5`. It is started on your go after handback, using Task 9's CLI.
- Triage of extra findings (yours, in `results/<run>/triage.jsonl`).
- The sluice gate, Linear ticket intent, and history-based precision (design: out of scope).
