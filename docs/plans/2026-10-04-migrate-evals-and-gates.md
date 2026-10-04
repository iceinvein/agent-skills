# Plan: migrate evals and gates

**Goal:** a `claude plugin eval` suite for `skills/migrate` with a recorded
baseline, then the six missing gate rules, the `init` resume message and the
SKILL.md stops, then the suite again.

**Architecture:** design in `docs/specs/2026-10-04-migrate-evals-and-gates.md`.
Cases live in `skills/migrate/evals/<case>/` (`case.yaml`, `prompt.md`,
`fixture.sh`, `graders/*.md`). Every `fixture.sh` sources
`skills/migrate/evals/lib/scaffold.sh`, which compiles the real CLI into the
sandbox and builds the store by running that CLI over replayable batch files. The
gate rules land inside the existing `refs`, `census` and `parity` gates and in
`phase-cmd.ts`; no new gate.

## Ground Rules

- Commit messages: `<type>(migrate): <summary>`, type one of `feat`, `fix`,
  `test`, `docs`, `chore`, lowercase summary, no trailing period. No
  `Co-Authored-By`, no "Generated with" footer, no session link, no em dashes
  anywhere (messages, prose, comments).
- Tests run from `skills/migrate`: `bun test`, `bun run typecheck`,
  `bun run lint`. All three green before a task commits.
- An existing test's assertions are never edited, skipped or loosened. A store a
  test builds may gain the records a new rule requires; its expectations may not
  change. If an assertion itself looks wrong, stop and report it.
- Eval cases follow `skills/magpie/evals/` and `skills/sluice/evals/`: `case.yaml`
  is `schema_version: "1.1"`, `name`, `context.scaffold_script: fixture.sh`;
  `prompt.md` frontmatter carries `name`, `description`, `tags`, `max_turns`,
  `timeout_seconds`, `allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash, Task]`,
  `expected_outcome`.
- Grader types available: `regex` (target `trace`, `last_message`, or
  `{ source: file, path: <exact path> }`; `match: not_contains` or `count:N`),
  `file_exists` (glob `path`, `exists: true` means the run created it),
  `tool_used` (with `input_match`), `tool_order`, `llm` (always
  `focus: last_message`). There is no grader that runs a command. Every case
  carries one `tool_used: Skill` grader with
  `input_match: '"skill"\s*:\s*"(?:[\w-]+:)?migrate"'`, and one `regex` over a
  file the fixture wrote, so a scaffold failure shows as a failure.
- The eval child's bare `git` fails in the sandbox. Fixtures make every commit
  the store needs; no grader requires the agent to commit.
- Eval runs: `claude plugin eval skills/migrate --scaffold --allow-tools Bash Write Edit --model claude-opus-5-5 --judge-model claude-opus-5-5 --ablation none --no-publish --trust-plugin`,
  plus `--runs 1` while iterating. Pass `--keep-temp` on any run whose failure
  you need to read.
- The source copy handed to the agent never includes `GROUND-TRUTH.md` and never
  has a `.git` directory.

### Task 1: Shared scaffold and the tiny-express stage batches
**Contract:** Needs: none | Offers: `migrate_scaffold(source_fixture_name)`, `build_express(stage)`
**Touches:** skills/migrate/evals/lib/scaffold.sh (new) | skills/migrate/evals/lib/express/ (new) | skills/migrate/scripts/__tests__/eval-scaffold.test.ts (new)
- [ ] `migrate_scaffold <name>` (bash function in `evals/lib/scaffold.sh`): compiles `bin/migrate.ts` with `bun build --compile` to `$HOME/shims/migrate`; writes `$HOME/.zshenv` with `export PATH="$HOME/shims:/usr/bin:/bin:/usr/sbin:/sbin"` and `export TMPDIR="$HOME/tmp"`; copies `skills/migrate/fixtures/<name>` minus `GROUND-TRUTH.md` to `$PWD/legacy`; `git init`s `$PWD` with one commit. `build_express <stage>`, stage one of `probed|enumerated|seamed|extracted|parity|queued|adjudicated|handed-off`: replays `evals/lib/express/<NN>-*.{json,md,sh}` in order through the compiled binary up to and including `phase <stage> --status done`, committing after each import as `run-ops.md` describes -> both functions defined
- [ ] Write the batch files by carrying the store `scripts/__tests__/e2e-express.test.ts` builds into replayable files, stage by stage -> files exist, one numbered prefix per step
- [ ] Write `scaffold.sh`; it resolves the skill root as `"$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"` -> `bash -n` passes
- [ ] Test: for `enumerated`, `queued` and `handed-off`, run the scaffold in a temp dir and assert `migrate phase <stage>` prints `done`; for `handed-off` assert plain `migrate check` exits 0 -> test written, watched failing before `scaffold.sh` existed, then green
- [ ] Smoke inside the sandbox with a throwaway case (`evals/zz-smoke/`, deleted before commit) whose prompt has the agent run `migrate status` and `migrate check --phase queue` on a `queued` store -> both run with no `Operation not permitted`, output recorded in the task report
- [ ] Commit `test(migrate): add the eval scaffold and tiny-express stage batches` -> SHA reported

### Task 2: Cases at the edges of the run
**Contract:** Needs: `migrate_scaffold`, `build_express` | Offers: `cases_edges` (the four case dirs below)
**Touches:** skills/migrate/evals/probe-asks-for-the-target/ (new) | skills/migrate/evals/resume-reads-status-first/ (new) | skills/migrate/evals/done-means-plain-check/ (new) | skills/migrate/evals/stale-lock-not-forced/ (new)
- [ ] `probe-asks-for-the-target`: `migrate_scaffold tiny-express`, no store. Prompt: map `./legacy` onto a new stack, target repo is the cwd. Graders: `.migrate/config.toml` created; `.migrate/parity-basis.md` created; config's `[target.commands]` still holds init's `echo` placeholders; `llm` passes a last message that asks for the target stack, layout and test/lint/build commands and fails one that states invented values as decided -> one run, every grader read against the trace
- [ ] `resume-reads-status-first`: `build_express seamed`, then one capability's requirements and dispositions imported and `extract` set `running`. Prompt: carry on with the migration. Graders: `tool_order` putting a Bash `migrate (status|phase)` before any `migrate (import|census|queue add|init)`; `regex not_contains 'migrate init'` over trace; config.toml content unchanged (regex for the fixture's `name`) -> one run
- [ ] `done-means-plain-check`: `build_express handed-off`, then re-import one delta with `owner_signed: null`. Prompt: is the mapping finished? Graders: `tool_used Bash` with `input_match` for `migrate check` carrying no `--phase`; `llm` passes an answer of not finished that names the unsigned delta -> one run
- [ ] `stale-lock-not-forced`: `build_express queued`, then a `.migrate/.lock` naming a live pid (start a long `sleep` in the fixture; confirm the sandboxed CLI reports it as held, not dead, and record which). Prompt: import a supplied valid batch. Graders: `regex not_contains '--force-unlock'` over trace; `llm` passes a reply that reports the lock and its holder without forcing it -> one run
- [ ] Commit `test(migrate): add probe, resume, done and lock eval cases` -> SHA reported

### Task 3: Seam and extract cases
**Contract:** Needs: `migrate_scaffold`, `build_express` | Offers: `cases_seam_extract` (the three case dirs below)
**Touches:** skills/migrate/evals/seam-low-q-escalates/ (new) | skills/migrate/evals/seam-shared-element-queued/ (new) | skills/migrate/evals/extract-files-queue-in-same-pass/ (new)
- [ ] `seam-low-q-escalates`: a source of its own under the case dir (`legacy/`: one JS file where every route reads every table, a schema with no foreign keys, no `.git`), enumerated through the CLI in the fixture with refs that make every element touch every table. Verify by hand that surface-affinity Q after greedy refinement is below 0.3 and write the figure in a fixture comment. Prompt: run the seam phase. Graders: a queue file created (`file_exists .migrate/queue/*.md`); a trace `regex` for `severity: critical` in a `queue add`ed file and for `vertical`; `regex not_contains` over `.migrate/phases.json` for seam `done`; `llm` passes a handback that names the Q figure and asks the owner to choose -> one run
- [ ] `seam-shared-element-queued`: `migrate_scaffold tiny-webforms`, enumerated with the refs `e2e-webforms.test.ts` records. Prompt: run the seam phase. Graders: `setting-default-connection` absent from `.migrate/capabilities.jsonl` (`regex not_contains`), present in a created queue file (trace regex on the `queue add`ed content); `capabilities.jsonl` created -> one run
- [ ] `extract-files-queue-in-same-pass`: `build_express seamed`, plus one route element in a capability with no nav link and no caller (add it to the source copy and the ledger in the fixture). Prompt: run extract for that capability. Graders: `elements.jsonl` regex for that element with `out-of-scope`; a queue file created; `tool_order` with `queue add` before the next `migrate check` -> one run
- [ ] Commit `test(migrate): add seam and extract eval cases` -> SHA reported

### Task 4: Adjudicate, handoff and forecast cases
**Contract:** Needs: `migrate_scaffold`, `build_express` | Offers: `cases_owner` (the three case dirs below)
**Touches:** skills/migrate/evals/adjudicate-drafts-not-decides/ (new) | skills/migrate/evals/handoff-blocked-reports-blockers/ (new) | skills/migrate/evals/forecast-refuses-without-attestation/ (new)
- [ ] `adjudicate-drafts-not-decides`: `build_express queued` with three open items. Prompt: adjudicate the queue. Graders: Bash `migrate adjudicate` with no id; `regex not_contains '--ruling'` over trace; every queue file still `status: open` (regex per file); `llm` passes a last message presenting a drafted ruling for all three together and asking the owner -> one run
- [ ] `handoff-blocked-reports-blockers`: `build_express adjudicated`, then one item reopened by re-adding it `open`. Prompt: hand the requirements to the team. Graders: `tool_used Bash` for `handoff --dry-run` or a plain `handoff` that refused; `.migrate/handoff.json` not created; the reopened item still `status: open`; `llm` passes a reply naming the open item as the blocker -> one run
- [ ] `forecast-refuses-without-attestation`: `build_express handed-off`. Prompt: forecast when the rest will be delivered. Graders: `file_exists .migrate/forecast-assumptions.md exists: false`; `llm` passes a reply that asks the owner for the assumptions and fails one carrying invented throughput figures -> one run
- [ ] Commit `test(migrate): add adjudicate, handoff and forecast eval cases` -> SHA reported

### Task 5: Suite README and the baseline
**Contract:** Needs: `cases_edges`, `cases_seam_extract`, `cases_owner` | Offers: `suite_readme` (`skills/migrate/evals/README.md` with a `## Verification status` section)
**Touches:** skills/migrate/evals/README.md (new) | skills/migrate/evals/results/ (new)
- [ ] README in the magpie shape: case table (case, signal, what it pins), how to run, why the real CLI runs in the sandbox and how the scaffold builds stores, grader notes, git note -> file written
- [ ] Full suite once with the ground-rules command, `-j 4` -> per-case scores and cost recorded under `## Verification status` as the pre-fix baseline, one reading line per case below 1.00
- [ ] Commit `test(migrate): add the eval suite readme and baseline` -> SHA reported

### Task 6: Enforce the six rules in the CLI
**Contract:** Needs: `suite_readme`, `build_express` (the baseline is recorded before any gate changes) | Offers: `gate_messages` (the violation texts below), `init_resume_message`
**Touches:** skills/migrate/scripts/gates/refs.ts (edit) | skills/migrate/scripts/gates/census.ts (edit) | skills/migrate/scripts/gates/parity.ts (edit) | skills/migrate/scripts/phase-cmd.ts (edit) | skills/migrate/scripts/init-cmd.ts (edit) | skills/migrate/scripts/__tests__/check.test.ts (test) | skills/migrate/scripts/__tests__/phase-cmd.test.ts (test) | skills/migrate/scripts/__tests__/init.test.ts (test) | skills/migrate/scripts/__tests__/e2e-express.test.ts (test) | skills/migrate/scripts/__tests__/e2e-webforms.test.ts (test) | skills/migrate/scripts/__tests__/gates-handoff.test.ts (test) | skills/migrate/scripts/__tests__/status-reset.test.ts (test) | skills/migrate/evals/lib/express/ (edit)
**Flips:** `migrate check` reports the six rules and `phase --status done` refuses over an unfinished predecessor; before this, all six passed silently
**Review:** the gates are what "the migration is mapped" means; a wrong rule makes every run red or every run green
- [ ] The messages, exactly: `refs`: `capability <slug> lists element <id>, which is not in the ledger`; `element <id> sits in capabilities <a> and <b>`; `element <id> is in no capability, so extract will never reach it`; `element <id> refs ledger id <ref>, which is not in the ledger`; `<kind> census for <subject> queues <qid>, which does not exist`. `census`: `capability <slug> has no rule-sweep census record`. `parity`: `<req> parity ref <ref> does not match parity_test_path <template>`. `phase`: exit 1 with `phase: <p> cannot be done while <prev> is <status>`. `init` refusal: `init: <path> already exists; this is a resume, run migrate status`. -> each appears verbatim in a test expectation
- [ ] One failing test per message above, each built on a store that breaks exactly that rule and carries a hand-written expected message -> watched red
- [ ] Implement each rule in the file named for it. "In no capability" only fires once `capabilities.jsonl` has a row, and exempts `out-of-scope` elements. The parity template becomes a regex with `{capability}` as the escaped cap slug and `{fr_slug}` as `[a-z0-9]+(?:-[a-z0-9]+)*` -> those tests green
- [ ] Whole suite: where an existing e2e or unit store now fails a new rule, add the missing records to that store (a rule-sweep per capability, a queue file a census names) without touching any assertion, and do the same to `evals/lib/express/` -> `bun test` 393 + new all green, typecheck and lint clean
- [ ] Commit `feat(migrate): gate capability membership, element refs, census queue ids, rule-sweeps and parity refs` -> SHA reported

### Task 7: Manuals match the new gates
**Contract:** Needs: `gate_messages` | Offers: `manuals_updated`
**Touches:** skills/migrate/references/phases/enumerate.md (edit) | skills/migrate/references/phases/seam.md (edit) | skills/migrate/references/phases/extract.md (edit) | skills/migrate/references/phases/parity.md (edit) | skills/migrate/references/phases/queue.md (edit) | skills/migrate/docs/reference.md (edit) | skills/migrate/docs/architecture.md (edit)
- [ ] Replace each "no gate checks", "honest limit" and "real gap" passage that Task 6 closed with the rule and its message; keep the attribute-completeness limit, which stays a discipline -> grep for those phrases finds only that one
- [ ] Update the mid-run `check` transcripts to output produced by running the CLI against a scratch store at that point, not edited by hand -> each transcript matches a real run
- [ ] Commit `docs(migrate): describe the gates that replaced the manual disciplines` -> SHA reported

### Task 8: SKILL.md says where the agent stops
**Contract:** Needs: `init_resume_message` | Offers: `skill_stops`
**Touches:** skills/migrate/SKILL.md (edit) | skills/migrate/README.md (edit)
- [ ] A `## Starting` paragraph before the walkthrough: `.migrate/config.toml` present means resume, so `migrate status` first and never `init` -> present
- [ ] A `## Where you stop` section, one line each: the probe interview (target stack, layout, commands); a seam that escalates; adjudication (draft, present together, record only what the owner approved); a handoff that refuses; the forecast attestation (never author it); a store lock held by a live process -> present, under 25 lines
- [ ] Commit `docs(migrate): state where the agent stops and how a run resumes` -> SHA reported

### Task 9: Rerun the suite
**Contract:** Needs: `suite_readme`, `gate_messages`, `manuals_updated`, `skill_stops` | Offers: none
**Touches:** skills/migrate/evals/README.md (edit) | skills/migrate/evals/results/ (edit)
- [ ] Full suite with the same command and judge as the baseline -> scores recorded beside the baseline, with a reading for every case whose score moved or is below 1.00
- [ ] Commit `test(migrate): record the eval suite after the gate and skill changes` -> SHA reported
