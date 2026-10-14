# Plan: verification gates

**Goal:** each code channel gets a verification gate: `fast` and `main` a passing
check recorded against the tree as it stands and enforced by the Stop hook,
`main` a bug-hunter hunt when the agreed intent has a checkable claim, `deep` a
hunt over the whole plan diff after the flip, before the final review. Design:
`docs/specs/2026-10-14-verification-gates.md`.

**Architecture:** `status.sh verify` writes `<tree>/.sluice/verified`, one line,
the digest `tree-snapshot.sh` prints for the tree. `stop-guard.sh` compares that
line with a fresh digest in sessions whose last route is `fast` or `main` and
whose tree moved since the session's entry stamp. The hunts are prose rules in
SKILL.md and the references, measured by new eval cases. Bug-hunter is unchanged.

## Ground Rules

- Commit message: `<type>(<scope>): <summary>`, lowercase summary, scope `sluice`
  or `eval-freshness`, a body saying why. No `Co-Authored-By`, no "Generated
  with", no session link, no AI attribution of any kind. No em dashes anywhere,
  in code, prose, comments or messages.
- TypeScript uses tabs; shell matches `skills/sluice/scripts/status.sh` (bash,
  `set -uo pipefail`, its `err` helper, its exit-code table in the header).
- Tests assert observable behaviour with hand-written expected values, one
  behaviour per test, named for the behaviour. Never fix a failing test by
  editing it; report it instead.
- `bun test` from the repo root is green before every commit, and the commit
  stages only the paths in the task's Touches, never `git add -A`.
- No new dependencies. Comments say why, never what.
- Eval cases follow `skills/sluice/evals/README.md` and the existing cases:
  `case.yaml` with `schema_version: "1.1"`, `context.scaffold_script: fixture.sh`,
  a `sluice-fired` grader, graders under `graders/`. Every new case is pinned
  by a rule in `skills/sluice/evals/rules.json` in the same commit, with
  `origin: docs/specs/2026-10-14-verification-gates.md`.

### Task 1: status.sh verify

**Contract:** Needs: none | Offers: `status.sh verify [--dir <path>] -- <cmd> [args...]` -> runs the command in the tree, passes its stdout, stderr and exit code through; on exit 0 writes `<tree>/.sluice/verified` holding exactly one line, the stdout of `tree-snapshot.sh <tree>`; on non-zero leaves any existing file untouched | `status.sh verify [--dir <path>] --none <reason>` -> writes the same line, prints `sluice: verified with no check: <reason>`, exits 0; exits 4 when the reason is empty or missing | `<tree>` is `git -C <dir> rev-parse --show-toplevel`; outside a git tree verify exits 4 and writes nothing
**Touches:** skills/sluice/scripts/status.sh (edit) | tests/sluice-status.test.ts (test)
**Review:** modifies the run-state script every hook reads
- [ ] Tests first in `tests/sluice-status.test.ts`, each in a temp git repo with one commit: a passing command writes `.sluice/verified` whose one line equals `bash skills/sluice/scripts/tree-snapshot.sh <tree>`'s stdout; a failing command (`-- false`) exits 1 and writes no file; a failing command leaves an earlier file's line unchanged; `--none "docs only"` writes the line and prints the reason; `--none` with no reason exits 4; a non-git dir exits 4; `.sluice/` holds a `.gitignore` of `*` afterwards so `git status --porcelain` stays empty -> they fail before the code
- [ ] Add the `verify` subcommand beside `route` (before the jq check, since it needs no run), its usage line in the header block, and create `.sluice/` through the existing self-ignoring helper -> the new tests pass, `bun test` green
- [ ] Commit `feat(sluice): status.sh verify records a passing check against the tree` -> report the SHA

### Task 2: eval cases for the fast and main gates

**Contract:** Needs: none | Offers: eval cases `fast-verifies-before-handback`, `main-hunts-a-checkable-claim`, `main-skips-the-hunt-without-a-claim`; rules `verified-before-handback`, `main-hunts-a-checkable-claim`, `main-skips-the-hunt-without-a-claim` in rules.json
**Touches:** skills/sluice/evals/fast-verifies-before-handback/ (new) | skills/sluice/evals/main-hunts-a-checkable-claim/ (new) | skills/sluice/evals/main-skips-the-hunt-without-a-claim/ (new) | skills/sluice/evals/rules.json (edit)
**Review:** graders decide what the gates are measured by
- [ ] Probe first, outside the repo: copy `skills/sluice` and `skills/bug-hunter` into a scratch dir side by side, add one case under the sluice copy whose `case.yaml` sets `plugins: ["../..", "../../../bug-hunter"]` and whose prompt asks to hunt one tiny file, run `claude plugin eval <scratch>/sluice --case <it> --scaffold --allow-tools Bash Write Edit --model claude-opus-5-5 --judge-model claude-opus-5-5 --ablation none --runs 1 --keep-temp --no-publish --json <scratch>/probe.json` -> the kept trace shows a `Skill` call for bug-hunter whose result loaded the skill. If it did not load, stop: commit nothing and report what the trace shows
- [ ] `fast-verifies-before-handback`: the `fast-flag-on-existing-command` fixture and prompt copied; graders `sluice-fired`, and a regex over the trace (weight 3) matching a Bash command invoking `status.sh verify --` after the last Write or Edit call -> the grader pattern checked by hand against a trace line with the call after the last edit (match) and one with an Edit after it (no match)
- [ ] `main-hunts-a-checkable-claim`: a small Node repo with an existing helper `lastPage(total, size)` that floors where it must ceil; the prompt asks for a new exported `pageOf(index, size, total)` whose stated contract includes "the last page holds the remainder"; `plugins` as in the probe. Graders: `sluice-fired`; bug-hunter fired (`tool_used` Skill, input matching bug-hunter); a regex over the trace that a Write or Edit under `src/` comes before the bug-hunter Skill call; a file grader that the helper now rounds up; an `llm` grader that a test asserting the remainder page was added -> each regex checked by hand against a sample trace line
- [ ] `main-skips-the-hunt-without-a-claim`: a main-shaped request with no checkable claim (move a module behind a new interface with behaviour unchanged, as `main-new-interface` does); `plugins` as in the probe. Graders: `sluice-fired`; bug-hunter not invoked (`tool_used` with `min: 0`/`max: 0` if supported, else a `not_contains` regex on the bug-hunter Skill call); an `llm` grader that the handback says in one line no checkable claim was found -> the not-invoked grader checked by hand against a trace line with the bug-hunter Skill call (fails) and one without (passes)
- [ ] Add the three rules to `rules.json` (`states` pointing at `SKILL.md: The rules`) -> `bun test tests/eval-freshness-skills.test.ts` green
- [ ] Commit `test(sluice): eval cases for the fast and main verification gates` -> report the SHA

### Task 3: eval case for the deep hunt

**Contract:** Needs: none | Offers: eval case `deep-run-hunts-after-the-flip`; rule `deep-hunts-after-the-flip` in rules.json
**Touches:** skills/sluice/evals/deep-run-hunts-after-the-flip/ (new) | skills/sluice/evals/rules.json (edit)
**Review:** graders decide what the gate is measured by
- [ ] Copy `deep-run-finishes-every-task`'s fixture shape: a signed-off plan, pre-flight answered, every task `done` but the flip, whose spec states a checkable limit the flip's code breaks by one; `plugins: ["../..", "../../../bug-hunter"]`. Graders: `sluice-fired`; a regex over the trace that the bug-hunter Skill call comes after the flip task's `--status done` and before `status.sh final`; a file grader that the off-by-one is fixed; a regex on the run record for a `## Hunt` section -> each regex checked by hand against sample trace lines
- [ ] Add the rule to `rules.json` (`states: "references/deep-channel.md: The final review"`) -> `bun test tests/eval-freshness-skills.test.ts` green
- [ ] Commit `test(sluice): eval case for the deep hunt after the flip` -> report the SHA

### Task 4: turn the gates on

**Contract:** Needs: `status.sh verify [--dir <path>] -- <cmd> [args...]` | Offers: Stop hook refusal `{"decision":"block","reason":...}` for an unverified moved tree in a fast or main session; SKILL.md rule lines for the three gates
**Touches:** skills/sluice/scripts/stop-guard.sh (edit) | skills/sluice/SKILL.md (edit) | tests/sluice-stop-guard.test.ts (test) | tests/sluice-skill.test.ts (test)
**Flips:** handbacks in fast and main sessions go from unchecked to refused once per turn until `.sluice/verified` matches the tree; SKILL.md goes from one prose verify rule to a gate per channel
- [ ] Tests first in `tests/sluice-stop-guard.test.ts`, reusing its `gitRepo`, `stamp` and transcript helpers: a fast-routed session whose tree moved and has no `.sluice/verified` is refused with a reason naming `status.sh verify --` and `--none`; a main-routed session likewise; a verified tree passes; a tree edited after verifying is refused; a deep-routed session is not refused by this gate; a session whose tree did not move is not refused; `stop_hook_active: true` passes -> they fail before the code
- [ ] Add the gate to `stop-guard.sh` after the entry check, reading the session's last route call with the same `route` pattern, the entry stamp for "moved", and `tree-snapshot.sh` for the digest -> the new tests pass, every existing stop-guard test still passes
- [ ] SKILL.md: extend the Verify rule line with the recorded check and the hook, add one line each for the main hunt (checkable claim, fix proven bugs test-first, ambiguities to the partner) and the deep hunt (after the flip, before the final review), each pointing at its reference; tests in `tests/sluice-skill.test.ts` that the router names `status.sh verify`, the main hunt's checkable-claim condition, and the deep hunt's place before the final review -> green
- [ ] Commit `feat(sluice): a verification gate on each channel` -> report the SHA

### Task 5: references for the gates

**Contract:** Needs: Stop hook refusal for an unverified moved tree; SKILL.md rule lines for the three gates | Offers: none
**Touches:** skills/sluice/references/verify.md (edit) | skills/sluice/references/review.md (edit) | skills/sluice/references/deep-channel.md (edit) | skills/sluice/references/finish.md (edit) | skills/sluice/references/status.md (edit) | tests/sluice-skill.test.ts (test)
- [ ] `verify.md`: the recorded check, `--none` and when it is honest, what the hook refuses and why it is once per turn. `review.md`: the main hunt (D3), bug-hunter unavailable said in the announcement and at the merge (D5), the reviewer's brief carrying the hunt report path. `deep-channel.md`: a `## The hunt` section before `## The final review` (D4), the run record's `## Hunt` section. `finish.md`: an open proven bug stops before the three options. `status.md`: the `verify` command -> each claim matches the spec's D1 to D5
- [ ] Tests in `tests/sluice-skill.test.ts` pinning: verify.md names `--none`; review.md says a missing bug-hunter is said at the announcement and the merge; deep-channel.md's hunt section comes before the final review section; finish.md stops on an open proven bug -> green
- [ ] Commit `docs(sluice): references for the verification gates` -> report the SHA

### Task 6: version and case table

**Contract:** Needs: eval cases `fast-verifies-before-handback`, `main-hunts-a-checkable-claim`, `main-skips-the-hunt-without-a-claim`, `deep-run-hunts-after-the-flip` | Offers: none
**Touches:** skills/sluice/skill.json (edit) | skills/sluice/evals/README.md (edit)
**Effort:** low, a version string and four table rows copied from the case descriptions
- [ ] `skill.json` version `0.24.0`; four rows in the evals README case tables (three in the routing table, the deep case in the execution table), and the case count in its opening line -> `bun test` green
- [ ] Commit `chore(sluice): 0.24.0` -> report the SHA
