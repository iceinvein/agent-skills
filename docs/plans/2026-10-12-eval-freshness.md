# Plan: eval freshness

**Goal:** a local, plan-billed mechanism that tells you, per model, which sluice and
bug-hunter rules regressed and which the bare model now covers on its own.

**Architecture:** a `rules.json` manifest per skill maps rules to eval cases. A
reducer turns a two-arm `claude plugin eval --json` result into a committed
per-model baseline. A comparer classifies each case and rolls the verdicts up per
rule. One CLI, `scripts/eval-freshness.ts`, has three subcommands: `run`, `diff` and
`accept`. Design: `docs/specs/2026-10-12-eval-freshness.md`.

**Deviation from the signed-off design (D4):** "more than one run's worth" (1/runs)
can never flag a single-run regression, because a mean cannot drop by more than
1.0. A case is `regressed` when its `with` mean falls below the baseline's by more
than a tolerance, `--tolerance`, default `0.1`.

## Ground Rules

- Bun and TypeScript, ES modules, tab indentation, matching `scripts/audit-skills.ts` and `tests/*.test.ts`. No new dependencies.
- Tests use `bun:test` and live in `tests/`. Each test is named for the behaviour it pins. Expected values are written by hand, never produced by running the code under test.
- Commit messages: `<type>(<scope>): <subject>`, lower case, imperative. Scope is `eval-freshness`, `sluice` or `bug-hunter`. The body says why, wrapped at 72 columns. No `Co-Authored-By` trailer, no "Generated with" footer, no session link, no em dashes.
- Paid eval runs happen only in Task 1 and Task 8, always with `--model claude-opus-5-5 --judge-model claude-opus-5-5`. They run on the user's logged-in Claude plan; no API key is set.
- Nothing writes under `.sluice/`.
- Comments say why, never what.
- Skill paths are passed as paths (`skills/sluice`), the way `claude plugin eval` takes them.

### Task 1: Capture a real two-arm result

**Contract:** Needs: none | Offers: file `tests/fixtures/eval-freshness/two-arm-bypass.json` (a complete `claude plugin eval --json` result with `suite.ablation` `with-without` and a completed `without` arm)
**Touches:** tests/fixtures/eval-freshness/two-arm-bypass.json (new)
- [ ] Run `claude plugin eval skills/sluice --case 'bypass-*' --ablation with-without --runs 1 --model claude-opus-5-5 --judge-model claude-opus-5-5 --json tests/fixtures/eval-freshness/two-arm-bypass.json` -> file exists, `partial` is false
- [ ] Read the file and record the key that holds the no-plugin arm under `cases[].arms`, and how `withOnly` graders appear in it -> the key name is written in the run record

### Task 2: Rules manifest loader and checker

**Contract:** Needs: none | Offers: `scripts/eval-freshness/manifest.ts` exporting `type Rule = { id: string; states: string; origin: string; cases: string[]; unpinned?: string }`, `type Manifest = { rules: Rule[]; sandboxSensitive: string[] }`, `loadManifest(skillDir: string): Manifest` (throws when `evals/rules.json` is missing or not that shape), `caseNames(skillDir: string): string[]` (sorted names of directories under `evals/` holding `prompt.md` or `case.yaml`), `checkManifest(skillDir: string): string[]` (one line per problem, empty when consistent)
**Touches:** scripts/eval-freshness/manifest.ts (new) | tests/eval-freshness-manifest.test.ts (test)
**Effort:** low, the contract and the problem list below are exact and nothing turns on judgment
- [ ] `checkManifest` reports each of these as its own line: a rule naming a case that does not exist; a case no rule names; a duplicate rule id; a rule with empty `cases` and no `unpinned`; a rule with both cases and `unpinned`; a `sandboxSensitive` name that is not a case; a `states` whose file part (before `:`) does not exist under the skill dir; an `origin` that does not exist relative to the repo root (two levels above the skill dir) -> one test per problem over a temp skill tree, each asserting the exact line
- [ ] A consistent temp tree yields `[]` -> test passes
- [ ] `caseNames` ignores `results/`, `README.md`, and directories with neither marker file -> test passes

### Task 3: Reduce and compare

**Contract:** Needs: file `tests/fixtures/eval-freshness/two-arm-bypass.json`, `type Manifest` | Offers: `scripts/eval-freshness/compare.ts` exporting `type CaseRecord = { with: number[]; without: number[] }`, `type Baseline = { model: string; judgeModel: string; claudeVersion: string; skillVersion: string; date: string; cases: Record<string, CaseRecord> }`, `reduce(result: unknown, skillVersion: string): Baseline` (throws when `partial` is true, `suite.ablation` is not `with-without`, or `suite.modelOverride` is absent), `type CaseVerdict = "regressed" | "redundant" | "flaky" | "sandbox" | "new" | "steady"`, `type Report = { model: string; against: string | null; cases: { name: string; verdicts: CaseVerdict[]; withMean: number; withoutMean: number; baselineWithMean: number | null }[]; rules: { id: string; status: "at-risk" | "expiry-candidate" | "unpinned" | "ok" }[] }`, `compare(current: Baseline, baseline: Baseline | null, manifest: Manifest, tolerance: number): Report`, `formatReport(report: Report): string`
**Touches:** scripts/eval-freshness/compare.ts (new) | tests/eval-freshness-compare.test.ts (test) | tests/fixtures/eval-freshness/two-arm-bypass.json (test)
- [ ] `reduce` on the Task 1 fixture yields the model, judge, CLI version and one case whose `with` and `without` arrays hold the per-run scores read from the file by hand -> test passes with those literals
- [ ] `reduce` throws on a partial result, a `none` ablation, and a missing `modelOverride` -> three tests pass
- [ ] Verdicts: `regressed`: the `with` mean is below the baseline mean minus `tolerance`. `sandbox`: the same drop on a `sandboxSensitive` case, and it never also counts as regressed. `redundant`: the `without` mean is at least the `with` mean, and the `with` mean is 1. `flaky`: the per-run `passed` values differ within an arm (a run passes at score 1). `new`: the case is absent from the baseline. `steady`: none of the above apply. With a null baseline, neither `regressed` nor `new` is emitted. -> one test per verdict, built from hand-written `Baseline` literals
- [ ] Rule status: `at-risk` when any of the rule's cases is `regressed`. `expiry-candidate` when every case is `redundant`. `unpinned` when the rule has no cases. `ok` otherwise. -> one test per status
- [ ] `formatReport` lists at-risk rules first, then expiry candidates, then non-steady cases, and states the baseline used or that there was none -> test asserts on the hand-written expected text for one small report

### Task 4: The CLI

**Contract:** Needs: `loadManifest(skillDir: string): Manifest`, `reduce(result: unknown, skillVersion: string): Baseline`, `compare(current: Baseline, baseline: Baseline | null, manifest: Manifest, tolerance: number): Report`, `formatReport(report: Report): string` | Offers: `bun scripts/eval-freshness.ts run <skillDir> --model <id> [--runs <n>] [-j <n>] [--case <glob>] [--tolerance <x>]`, `... diff <skillDir> <result.json> [--against <model>] [--tolerance <x>]`, `... accept <skillDir> <result.json>`; exit 0 no regression, 1 a regression, 2 bad arguments or unreadable input; `package.json` script `"eval:fresh": "bun run scripts/eval-freshness.ts"`
**Touches:** scripts/eval-freshness.ts (new) | package.json (edit) | tests/eval-freshness-cli.test.ts (test)
**Effort:** low, every behaviour is fixed by the contract and Task 3 owns the logic
- [ ] `run` spawns `claude plugin eval <skillDir> --scaffold --allow-tools Bash Write Edit --ablation with-without --model <id> --judge-model <id> --runs <n default 3> -j <n default 2> [--case <glob>] --json <skillDir>/evals/results/fresh-<model>-<ISO timestamp with : replaced by ->.json`, streams its output, then runs `diff` on that file -> read the code against this line (the paid path is exercised in Task 8)
- [ ] `diff` reads `skill.json` version, reduces the result, loads `evals/baselines/<model>.json` (or `<against>.json` with `--against`, missing file means null baseline), prints `formatReport`, and exits 1 only when some case is `regressed` -> CLI tests over a temp skill dir: exit 0 and "no baseline" text with none; exit 1 with a baseline the result regresses against
- [ ] `accept` writes the reduced baseline to `evals/baselines/<model>.json` as two-space JSON with a trailing newline -> CLI test reads the file back and compares it with a hand-written expected object
- [ ] Unknown subcommand or missing argument prints usage and exits 2 -> CLI test

### Task 5: Sluice rules manifest

**Contract:** Needs: `checkManifest(skillDir: string): string[]`, `type Manifest` | Offers: file `skills/sluice/evals/rules.json`
**Touches:** skills/sluice/evals/rules.json (new) | skills/sluice/evals/README.md (edit) | skills/sluice/skill.json (edit)
- [ ] Write one rule per rule SKILL.md states: the four channel routes; announce with the route call; read repo instructions before routing; choices go through AskUserQuestion; the deep design stop, the fork question first, and the pre-flight stop; escalate out loud, and explicit instruction collapses to fast; the seven rules (agree intent, test first, root cause, verify, review, finish, meter), plus show-or-say; stand down under superpowers; the deep-run execution rules the six `deep-run-*` cases pin. Each rule takes `cases` from `evals/README.md`'s tables, or an honest `unpinned` reason, and an `origin` that exists under `docs/specs` or `docs/plans`. Put `deep-run-fans-out` and every other `deep-run-*` case that commits in `sandboxSensitive`. -> `bun -e "import {checkManifest} from './scripts/eval-freshness/manifest.ts'; console.log(checkManifest('skills/sluice'))"` prints `[]`
- [ ] README "Running" gains the `eval:fresh` commands and one paragraph on verdicts. The existing verification history is not touched -> read back
- [ ] Patch-bump `skills/sluice/skill.json` version -> `bun run skill:bump:check` does not list sluice

### Task 6: Bug-hunter rules manifest

**Contract:** Needs: `checkManifest(skillDir: string): string[]`, `type Manifest` | Offers: file `skills/bug-hunter/evals/rules.json`
**Touches:** skills/bug-hunter/evals/rules.json (new) | skills/bug-hunter/evals/README.md (edit) | skills/bug-hunter/skill.json (edit)
- [ ] One rule per bug-hunter rule: no repro, no finding; a silent spec is an ambiguity; intent before implementation (scenarios before bodies); the scratch worktree leaves the caller's tree unchanged; findings are written with the Write tool to the stated shape; stop when there is no intent; the single-agent fallback; the hand-back. Cases come from `evals/README.md`'s table, otherwise `unpinned` with a reason. `origin` is `docs/plans/2026-10-12-bug-hunter.md` or an existing spec. `sandboxSensitive` is empty unless a case commits. -> `checkManifest('skills/bug-hunter')` prints `[]`
- [ ] README "Running" gains the `eval:fresh` commands -> read back
- [ ] Patch-bump `skills/bug-hunter/skill.json` version -> `bun run skill:bump:check` does not list bug-hunter

### Task 7: Enforce manifests in the suite

**Contract:** Needs: `checkManifest(skillDir: string): string[]`, file `skills/sluice/evals/rules.json`, file `skills/bug-hunter/evals/rules.json` | Offers: test `tests/eval-freshness-skills.test.ts`
**Touches:** tests/eval-freshness-skills.test.ts (new)
**Flips:** `bun test`, and so the publish job, starts failing when any skill's `rules.json` drifts from its eval cases; before this nothing checked them
**Review:** flips the publish gate
- [ ] One test per `skills/*/evals/rules.json` found, asserting `checkManifest` returns `[]`, plus one asserting at least the sluice and bug-hunter manifests were found -> `bun test` green
- [ ] Rename a sluice case directory in a scratch copy and run the test against it -> red, naming the case; restore

### Task 8: First read on claude-opus-5-5

**Contract:** Needs: `bun scripts/eval-freshness.ts run`, file `skills/sluice/evals/rules.json`, file `skills/bug-hunter/evals/rules.json` | Offers: two result files under `skills/*/evals/results/` (gitignored) and their reports in the run record
**Touches:** skills/sluice/evals/results/ (new) | skills/bug-hunter/evals/results/ (new)
- [ ] `bun run eval:fresh run skills/bug-hunter --model claude-opus-5-5 --runs 1` -> report printed, exit code read
- [ ] `bun run eval:fresh run skills/sluice --model claude-opus-5-5 --runs 1` -> report printed, exit code read
- [ ] Copy both reports into the run record. Accept nothing: whether to accept these, or spend a `--runs 3` pass first, goes to the user at handback -> record holds both reports
