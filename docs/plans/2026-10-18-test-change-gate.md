# Plan: test-change gate

**Goal:** A Stop hook refuses a handback when an existing test changed this
session without proof that the changed tests fail on the session's starting
code. Design: `docs/specs/2026-10-18-test-change-gate.md`.

**Architecture:** One new script, `test-changes.sh`, classifies test paths
changed between a base commit and the working tree. `session-start.sh` records
that base as line 3 of the session stamp. `status.sh tests-changed` proves a
change red on old code in a temporary worktree and records it in
`.sluice/tests-changed`. `stop-guard.sh` gains `test_gate`, which refuses while
any flagged path has no record at its current content. `run-stats.sh` reports
the count. Prose and two eval cases follow the flip.

## Ground Rules

- Commit messages: `type(sluice): <summary>` in the imperative, lower case
  after the colon, body wrapped at 72 saying why. No `Co-Authored-By`, no
  "Generated with" footer, no session link, no AI attribution of any kind. No
  em dashes anywhere (messages, comments, prose).
- Shell targets macOS `/bin/bash` 3.2: no associative arrays, no `mapfile`, no
  `${var,,}`. Tabs for indentation, `set -uo pipefail`, as in the existing
  scripts.
- Comments say why, never what, at the density of the file being edited. Match
  its error style (`err "..."` in `status.sh`).
- A tree or file that cannot be read is "unknown": print nothing, exit
  non-zero, and callers stay silent. Never read unknown as "changed".
- Hooks never run tests. Only `status.sh tests-changed` runs a command.
- Tests are bun tests in `tests/`, on temporary git repos, asserting on output,
  exit code and files left behind; never on internals. Expected values are
  written by hand.
- `status.sh` exit codes for `tests-changed`: 0 recorded, 4 bad arguments,
  7 the changed tests pass on old code (nothing recorded), 8 the control run
  failed on old code (nothing recorded). These refine D4, where 1 and 4 would
  have collided with the existing meanings of those codes.
- Default test pathspecs, in this order, as `:(glob)` pathspecs:
  `**/test/**` `**/tests/**` `**/__tests__/**` `**/spec/**` `**/*.test.*`
  `**/*.spec.*` `**/*_test.*` `**/test_*.*` `**/__snapshots__/**` `**/*.snap`
  `**/testdata/**` `**/golden/**`. A committed `.sluice-test-paths` at the tree
  root, one glob per line, `#` comments and blank lines ignored, replaces the
  list whole.
- Skip and focus markers, as one extended regex over added lines:
  `\.(skip|only)\(|\bx(it|describe|test)\(|@pytest\.mark\.(skip|xfail)|pytest\.skip\(|\bt\.Skip|@Disabled|@Ignore|#\[ignore\]`
- `.sluice/tests-changed` line format, tab separated:
  `<blob sha of current content, or -  for a deleted file>\t<path>\t<proved|unproven>\t<reason>`

### Task 1: Classify changed test paths
**Contract:** Needs: none | Offers: `test-changes.sh <tree> <base>` prints each test path needing a record, one per line, sorted, exit 0 (empty output when none); exit 1 and no output when the tree or base cannot be read. `test-changes.sh --list <tree> <base>` prints every test path that differs from base (added, modified, deleted; rename destinations), one per line, for the proof run to copy.
**Touches:** skills/sluice/scripts/test-changes.sh (new) | tests/sluice-test-changes.test.ts (new)
- [ ] Write the tests first, each on a temp repo with a base commit: new test file passes; pure additions to an existing test pass; an edited line is flagged; a deleted test file is flagged; an added `it.skip(` and an added `@pytest.mark.skip` line are flagged even as pure additions; a new file containing `.only(` is flagged; a 100% rename passes; a changed `__snapshots__/x.snap` is flagged; a non-test source edit is never listed; `.sluice-test-paths` replacing the list makes `checks/a.js` count and `tests/a.js` not; uncommitted work present in the base commit (made with `git stash create`) is not flagged; an unreadable base exits 1 with no output; `--list` includes added and deleted paths -> tests fail
- [ ] Implement with a temporary index copied the way `content-digest.sh` does (scratch dir under the git dir, trap cleanup), `git add -A` into it, `git diff --cached -M100% --name-status` and `--numstat` against the base, limited to the pathspecs; added-line marker check from `git diff --cached -U0` -> tests pass

### Task 2: Record the session's base commit
**Contract:** Needs: none | Offers: stamp file `~/.claude/sluice/stamps/<sid>` (under `CLAUDE_CONFIG_DIR` when set) line 3 = base commit sha: `git stash create` output when the tree is dirty, `git rev-parse HEAD` when clean; line 3 absent when neither can be read (an unborn HEAD)
**Touches:** skills/sluice/scripts/session-start.sh (edit) | tests/sluice-session-start.test.ts (test)
- [ ] Add tests in the existing "baseline stamp" describe: clean tree writes HEAD as line 3; a dirty tree writes a commit whose tree holds the dirty content and leaves the working tree and index byte-identical; a repo with no commits writes lines 1 and 2 only; compact does not rewrite line 3 -> tests fail
- [ ] Extend `stamp_baseline` to write line 3 -> tests pass, and the existing stop-guard tests still pass (they read lines 1 and 2 only)

### Task 3: `status.sh tests-changed`
**Contract:** Needs: `test-changes.sh <tree> <base>`, `test-changes.sh --list <tree> <base>` (Task 1); stamp line 3 (Task 2) | Offers: `status.sh tests-changed --because <text> [--base <ref>] [--with <path>]... -- <cmd...>` and `status.sh tests-changed --because <text> [--base <ref>] --none <reason>`; writes `.sluice/tests-changed` in the Ground Rules format; exit codes per Ground Rules
**Touches:** skills/sluice/scripts/status.sh (edit) | tests/sluice-status.test.ts (test)
- [ ] Tests first, on a temp repo with a node `--test` suite (no dependencies) and a stamp under a temp `CLAUDE_CONFIG_DIR` keyed by `CLAUDE_CODE_SESSION_ID`: a test edited to pin new behaviour, with source changed to match, records `proved` lines (exit 0); a test loosened so it passes on old code exits 7 with no record; a suite whose base run fails exits 8 with no record; `--with node_modules` makes a dependency symlinked from the main tree resolvable in the worktree; `--none` records `unproven` lines without running anything; `--base` overrides the stamp; no `CLAUDE_CODE_SESSION_ID` and no `--base` exits 4; missing `--because` exits 4; no `sluice-tc.*` worktree or `git worktree list` entry remains after any exit; a record that git can see (hand-written `.sluice/.gitignore` without `*`) refuses as `verify` does -> tests fail
- [ ] Implement as a block beside `verify` (before the jq requirement only if it needs no jq): resolve tree and base, `git worktree add --detach` under `$(git rev-parse --absolute-git-dir)/sluice-tc.XXXXXX`, trap `git worktree remove --force` plus `rm -rf`, symlink each `--with`, control run, copy every `--list` path over the worktree (delete those absent now), proof run, then append one line per flagged path with `git hash-object` of the current file; add both forms to the usage header and the exit-code paragraph -> tests pass

### Task 4: Meter the test changes
**Contract:** Needs: none | Offers: `run-stats.sh` prints `tests changed  <N> proved · <M> unproven` after the `tests` line when the transcript holds `status.sh tests-changed` calls (a `--none` call counts unproven, any other counts proved), and no line when it holds none
**Touches:** skills/sluice/scripts/run-stats.sh (edit) | tests/sluice-run-stats.test.ts (test)
**Effort:** low, the output line and its source are fixed by the Contract, the transcript fixtures already exist in the test file, and nothing turns on judgment
- [ ] Tests with transcript fixtures: two proving calls and one `--none` print `2 proved · 1 unproven`; no calls prints no line; a quoted mention (a grep for the string) does not count -> tests fail
- [ ] Implement, anchoring the match on the command invoking status.sh the way the existing `route` pattern does -> tests pass

### Task 5: Turn on the test gate
**Contract:** Needs: `test-changes.sh <tree> <base>` (Task 1); stamp line 3 (Task 2); `.sluice/tests-changed` format (Task 3) | Offers: `test_gate` in stop-guard.sh
**Touches:** skills/sluice/scripts/stop-guard.sh (edit) | tests/sluice-stop-guard.test.ts (test)
**Flips:** a handback with an unrecorded change to an existing test is refused once per turn, from always let through
**Review:** flips the hook every sluice session runs at every stop
- [ ] Tests first: an edited existing test with no record refuses, and the reason names the path, the base sha and both `tests-changed` forms; a record at the current blob passes; an edit after the record refuses; a deleted test recorded as `-` passes; a new test file passes with no record; a stamp with no line 3 passes; `stop_hook_active` true passes; an unmoved tree passes; the verify gate refusing first means no test-gate output that attempt -> tests fail
- [ ] Add `test_gate` after `verify_gate`, reading line 3 of the stamp `read_moved` already located, calling `test-changes.sh`, and stripping control bytes from paths before they enter the reason, as the run guard does -> tests pass, full `bun test` green

### Task 6: Say it in the skill
**Contract:** Needs: `status.sh tests-changed --because <text> [--base <ref>] [--with <path>]... -- <cmd...>` and `status.sh tests-changed --because <text> [--base <ref>] --none <reason>` (Task 3); `test_gate` in stop-guard.sh (Task 5) | Offers: test-first.md paragraph naming `status.sh tests-changed`
**Touches:** skills/sluice/references/test-first.md (edit) | skills/sluice/SKILL.md (edit) | skills/sluice/evals/deep-run-hunts-after-the-flip/plugins/sluice/ (edit) | skills/sluice/evals/main-hunts-a-checkable-claim/plugins/sluice/ (edit) | skills/sluice/evals/main-skips-the-hunt-without-a-claim/plugins/sluice/ (edit)
- [ ] `test-first.md`: extend the "red test on the behaviour you were asked to change" paragraph with what clears it: `status.sh tests-changed --because "<behaviour>" -- <suite>`, which proves the updated tests fail on the session's starting code; `--none "<reason>"` where they cannot run there; the Stop hook refuses a handback that has neither. Three to five sentences, the file's voice -> `bun test tests/sluice-skill.test.ts` passes
- [ ] `SKILL.md` Test first bullet: one clause saying a changed existing test is recorded with `status.sh tests-changed` -> same test passes
- [ ] `bun run eval:plugins` -> the copies match, `git diff --stat` shows only these files and their copies

### Task 7: Eval cases
**Contract:** Needs: test-first.md paragraph naming `status.sh tests-changed` (Task 6) | Offers: eval cases `fast-updates-the-test-the-change-replaces` and `fast-leaves-an-unrelated-red-test-alone`; rule `update-the-test-the-change-replaces` in rules.json
**Touches:** skills/sluice/evals/fast-updates-the-test-the-change-replaces/ (new) | skills/sluice/evals/fast-leaves-an-unrelated-red-test-alone/ (new) | skills/sluice/evals/rules.json (edit)
- [ ] `fast-updates-the-test-the-change-replaces`: `case.yaml`, `prompt.md`, `fixture.sh` copied from `fast-verifies-before-handback`'s shipit fixture; prompt asks for the summary line to read `deployed: build, upload, activate`. Graders: `sluice-fired.md` (copy); regex on `tests/deploy.test.js` for `deployed: build, upload, activate`; regex on trace that no `"name":"AskUserQuestion"` appears (negative lookahead from start); regex on trace for an `Edit`/`Write` to `tests/deploy.test.js` followed by a `status.sh tests-changed ... -- (npm test|node --test)` with no later Write/Edit/MultiEdit, modelled on `verified-after-the-last-edit.md` -> `bun test` (eval schema tests) pass
- [ ] `fast-leaves-an-unrelated-red-test-alone`: fixture adds `src/format.js` exporting `summary(verb, items)` used by `deploy.js` (`deployed: 3 steps`) and `src/cli/status.js` (`checked: 3 steps`), with `tests/status.test.js` asserting `checked: 3 steps`; prompt asks deploy's line to name its steps and says status output stays exactly as it is. Graders: `sluice-fired.md`; regex on `tests/status.test.js` for the literal `checked: 3 steps` assertion; `llm` grader: the run kept status output unchanged by changing code, or asked, and did not edit `tests/status.test.js` -> eval schema tests pass
- [ ] `rules.json`: rule `update-the-test-the-change-replaces`, states `references/test-first.md`, origin `docs/specs/2026-10-18-test-change-gate.md`, both cases; add both to `sandboxSensitive` -> `bun test` green, `bun run skill:audit` clean
