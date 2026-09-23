# Plan: sluice-eval-followup

## Goal

The Stop hook lets a deep run wait on a dispatched agent, the deep eval
fixtures and handback judges stop penalising correct behaviour, and the deep
cases have a 5.5 score from runs that could commit. Design:
`docs/specs/2026-09-23-sluice-eval-followup.md`.

## Architecture

`stop-guard.sh`'s verdict lets a stop through when a task is `active` or
`review`, the two statuses deep-channel.md defines as "something dispatched is
out". The prose adds that wait to the wanted stops. The eval changes are data:
fixture plans and their generated run state, and grader prompt text. The rerun
reads its own traces for commits before any score is recorded as clean.

## Ground Rules

- Commit message convention: `<type>(<scope>): <subject>`, scope `sluice`,
  subject lower case, no trailing full stop. No `Co-Authored-By` trailer, no
  tool footer, no session link.
- Test runner: `bun test` from the repo root. Before Task 1: 1590 pass, 1 fail
  (the statusline test that reads the live run at the worktree root).
- Scripts stay bash 3.2 compatible and depend on nothing beyond `jq` and `git`.
- Prose follows the files it lands in: no em dashes, comments say why.
- Tests assert on what a caller observes. Expected values are written by hand.
- A fixture's `.sluice/run.json` is produced by `status.sh init`, `plan.sh
  import` and `status.sh preflight`, never typed or edited by hand, and its
  plan passes `plan.sh validate` with no errors.
- Eval runs use `--model claude-opus-5-5` and carry `--max-cost-usd`; the sum
  across this plan is at most 15.

### Task 1: hook lets an in-flight dispatch stop

**Contract:** Needs: none | Offers: `stop-guard.sh` prints nothing and exits 0 for a deep run past pre-flight with any task `active` or `review`; still refuses when open tasks are all `todo` and nothing is blocked or paused; the refusal reason carries one blocked sentence, the one naming `status.sh task <id> --status blocked`
**Touches:** skills/sluice/scripts/stop-guard.sh (edit) | tests/sluice-stop-guard.test.ts (test)

- [ ] Add tests: task 2 `active` and task 3 `todo` lets the stop through; task 2 `review` and task 3 `todo` lets it through; tasks 2 and 3 `todo` still refuses; the refusal contains "status.sh task <id> --status blocked" exactly once and "If one is blocked, mark it and say what is blocking it." not at all -> the first two and the last fail against the current hook
- [ ] Add an `in flight` branch to the verdict (any task `active` or `review` gives `{block: false}`) with a comment saying why, and drop the duplicated sentence from the reason, keeping the named command -> `bun test tests/sluice-stop-guard.test.ts` green, including any existing test that set a task `active` to reach a refusal, which is re-pointed at `todo` only if it was testing the refusal and not the status

### Task 2: prose names the wait as a wanted stop

**Contract:** Needs: `stop-guard.sh` in-flight rule | Offers: deep-channel.md lists waiting on a dispatched agent among the turns that do end, says the row goes `active` at the dispatch and not before, and no longer tells the controller to pause while an agent runs; SKILL.md's Stop-hook paragraph says the hook lets an in-flight dispatch stop
**Touches:** skills/sluice/references/deep-channel.md (edit) | skills/sluice/SKILL.md (edit) | tests/sluice-skill.test.ts (test)
**Flips:** a deep run may end its turn while a dispatched agent is out; before this task the hook allowed it and the skill still said to pause

- [ ] Add tests: the "turns that do end" sentence in deep-channel.md names waiting on a dispatched agent; deep-channel.md says a task goes `active` at the dispatch; SKILL.md's Stop-hook paragraph mentions a dispatch in flight -> fail against the current prose
- [ ] Edit the "never ends a turn" bullet and the Stop-hook paragraph to say so, keeping `status.sh pause --reason` for standing still on purpose -> `bun test tests/sluice-skill.test.ts` green

### Task 3: deep fixture fixes

**Contract:** Needs: none | Offers: the blocks fixture's Task 3 Contract reads `deploy(args: { dryRun: boolean }, sink?: { write(line: string): void }) -> void` with the sink defaulting to one that prints, and its steps keep `deploy(args)` working; every deep fixture's Task 2 steps say the existing dry-run test's expectation gains `quiet: false`
**Touches:** skills/sluice/evals/deep-run-blocks-on-a-real-decision/fixture.sh (edit) | skills/sluice/evals/deep-run-finishes-every-task/fixture.sh (edit) | skills/sluice/evals/deep-run-waits-for-a-running-agent/fixture.sh (edit) | skills/sluice/evals/deep-run-survives-a-milestone/fixture.sh (edit) | skills/sluice/evals/deep-run-decides-a-non-blocking-choice/fixture.sh (edit) | skills/sluice/evals/deep-run-fans-out/fixture.sh (edit)

- [ ] Edit each plan heredoc as the Offers line says, and regenerate each embedded run.json per the Ground Rules -> each fixture copied to a fresh scratch dir runs clean, `plan.sh validate` on its plan reports no errors, and `node --test "tests/*.test.js"` there is green
- [ ] In the blocks fixture, confirm the only thing in `API.md` the plan still breaks is the stdout contract Task 4 flips -> read back against API.md and the four Contracts

### Task 4: handback graders

**Contract:** Needs: none | Offers: the handback graders of finishes-every-task, survives-a-milestone and waits-for-a-running-agent say that ending on the partner's finish choice (merge, open a PR, or leave the branch) is part of a handback; the waits grader uses `focus: last_message`
**Touches:** skills/sluice/evals/deep-run-finishes-every-task/graders/did-not-check-in-between-tasks.md (edit) | skills/sluice/evals/deep-run-survives-a-milestone/graders/hands-back-finished-work.md (edit) | skills/sluice/evals/deep-run-waits-for-a-running-agent/graders/hands-back-after-the-last-result.md (edit)

- [ ] Add the sentence to each and switch the waits grader's focus, rewording its PASS line to what a final message alone can show -> read back against the Offers line

### Task 5: rerun and record

**Contract:** Needs: every change above | Offers: README 5.5 section updated with the rerun's scores, each marked for whether the run could commit
**Touches:** skills/sluice/evals/README.md (edit) | skills/sluice/evals/results/ (new)
**Review:** the numbers in the README are the claim this plan exists to make

- [ ] Run `deep-run-*` once each at `--ablation none --keep-temp --max-cost-usd 15` -> result JSON written
- [ ] For each case, read its trace for commits and for the Stop hook's reason text -> a per-case note of whether it committed and whether the hook fired
- [ ] Update the README table and prose -> every number matches its result JSON

### Task 6: version

**Contract:** Needs: every task above | Offers: sluice at 0.23.0
**Touches:** skills/sluice/skill.json (edit) | skills/index.json (edit)

- [ ] `bun run skill:bump sluice minor`, then `bun run build:index` -> skill.json reads 0.23.0, `bun test` green apart from the known statusline test
