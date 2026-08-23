# Plan: sluice on four harnesses

## Goal

Make `agent-skills install sluice --tool cursor|codex|gemini` produce a working
sluice on those harnesses. The blocker is one installer gap, `bundleRoot` being
implemented only in the claude adapter, and two things inside the skill that
break by construction off Claude Code: a deep channel built on subagent dispatch,
and a meter that reads the Claude Code session transcript.

Full rationale in `docs/specs/2026-08-23-sluice-cross-harness.md`.

## Architecture

One new module, `src/cli/adapters/bundle.ts`, owns writing a bundle tree with the
executable bit. All four adapters call it. Nothing else about the adapters
changes.

Inside the skill, capability is recorded rather than probed. There is no reliable
programmatic way for a script to ask the harness what it offers, and inventing
one would be a guess dressed as a check. The model knows its own tool list, so it
states what it has and `run.json` records the answer, which is the same shape as
the pre-flight rows: the file's job is to hold the answer so a later reader can
tell the question was asked.

The ledger splits in two along the line of what is measurable. `status.sh ledger`
reports what `run.json` already knows, which is every harness: channel, elapsed
from `started`, tasks done over total, and the commits. `run-stats.sh` keeps
tokens and agent costs, and where there is no transcript it says so and defers
rather than exiting as if there were no run.

## Ground Rules

- Commit convention: `feat(cli): <subject>` for `src/`, `feat(sluice): <subject>` for `skills/sluice/`
- No AI attribution trailers, no "Generated with" footers, no session links
- No em dashes in prose, commits or comments
- `bun test` stays green; baseline is 1161 passing across 101 files
- Run `bun run scripts/build-index.ts` after any `skill.json` change, and commit the result
- `bun run scripts/audit-skills.ts` must report 0 ERR, 0 WARN
- No release. `scripts/release.sh` is not run as part of this plan
- New bash goes in `skills/sluice/scripts/`, bash and jq only, no new runtime dependency

### Task 1: extract the bundle writer

**Contract:** Needs: none | Offers: `writeBundle(cwd, bundleRoot, promptPath, files)` -> `string[]`, `shouldBeExecutable(relPath, content)` -> `boolean`
**Touches:** src/cli/adapters/bundle.ts (new) | src/cli/adapters/claude.ts (edit) | tests/adapters/bundle.test.ts (test)
**Review:** every other adapter is built blind against this signature

- [ ] write `tests/adapters/bundle.test.ts` covering a tree written under a root, the prompt file skipped, `.sh` and `bin/` and shebang content chmodded to 0755, and the returned relative paths -> the suite fails on the missing module
- [ ] create `src/cli/adapters/bundle.ts` exporting `writeBundle` and `shouldBeExecutable`, moved verbatim from `claude.ts:5-10` and `claude.ts:139-152` -> new tests pass
- [ ] replace the block in `claude.ts` with a call to `writeBundle`, importing both -> `bun test tests/adapters/` passes unchanged, so the refactor moved code without changing behaviour

### Task 2: cursor and gemini write bundles

**Contract:** Needs: `writeBundle(cwd, bundleRoot, promptPath, files)` -> `string[]` | Offers: none
**Touches:** src/cli/adapters/cursor.ts (edit) | src/cli/adapters/gemini.ts (edit) | tests/adapters/cursor.test.ts (test) | tests/adapters/gemini.test.ts (test)
**Model:** cheap. The contract is exact, the test files already exist with a pattern to follow, and the change is one guarded call per adapter placed after the `supporting` block

- [ ] add a `bundleRoot` case to `tests/adapters/cursor.test.ts` asserting a bundled script lands under the root and is executable -> it fails, because cursor writes no tree
- [ ] add the same case to `tests/adapters/gemini.test.ts` -> it fails for the same reason
- [ ] in each adapter, after the `supporting` block, call `writeBundle` when `config.bundleRoot && manifest.bundle` and push its paths onto `installed` -> both new cases pass and the existing cases stay green
- [ ] confirm `remove` already deletes what `install` returned, since both iterate `installedFiles` -> a bundled install followed by a remove leaves no files under the root

### Task 3: codex writes a bundle beside its AGENTS.md append

**Contract:** Needs: `writeBundle(cwd, bundleRoot, promptPath, files)` -> `string[]` | Offers: none
**Touches:** src/cli/adapters/codex.ts (edit) | tests/adapters/codex.test.ts (test)
**Model:** cheap. Same call as Task 2, with one existing control-flow bug to route around rather than any new judgement

- [ ] add a case to `tests/adapters/codex.test.ts` asserting a bundled script lands under `bundleRoot` and is executable while `AGENTS.md` still gets the appended section -> it fails, because codex writes no tree
- [ ] note the early `return installed` in the `config.mcpServers` branch at `codex.ts:12-16`: it would skip a bundle for any skill declaring both. Write the bundle before that branch, or make the branch warn without returning -> a fixture with both an MCP server and a bundle installs the bundle
- [ ] call `writeBundle` when `config.bundleRoot && manifest.bundle` -> the new case passes and the append cases stay green
- [ ] `remove` currently only strips the AGENTS.md section. Extend it to unlink the bundle paths -> install then remove leaves neither the section nor the tree

### Task 4: record what the harness offers

**Contract:** Needs: none | Offers: `status.sh capabilities [--dispatch yes|no] [--tokens yes|no] [--worktree yes|no]` writing `.capabilities` into `run.json`
**Touches:** skills/sluice/scripts/status.sh (edit) | tests/sluice-status.test.ts (test)

- [ ] add tests: each flag lands under `.capabilities`, a value outside `yes|no` exits 4 naming it, the subcommand needs a live run and readable state, and `show` prints the capabilities row as "not recorded" until it is set -> they fail on the unknown subcommand
- [ ] add the `capabilities` case to `status.sh`, reusing `need_value`, `require_run`, `require_readable` and `write_state` rather than new argument handling -> tests pass
- [ ] add the row to `show`'s header block beside `pre-flight` -> the row appears, and a run with none says so rather than printing an empty field

### Task 5: a ledger that works without a transcript

**Contract:** Needs: none | Offers: `status.sh ledger` printing channel, elapsed, tasks done over total, and commits
**Touches:** skills/sluice/scripts/status.sh (edit) | tests/sluice-status.test.ts (test)

- [ ] add tests: the ledger names the channel and the done-over-total count, lists each recorded commit, computes elapsed from `started`, and prints "tokens not measurable on this harness" when `.capabilities.tokens` is `no` -> they fail on the unknown subcommand
- [ ] add the `ledger` case, deriving every figure from `run.json` and taking elapsed from `started` against the current time -> tests pass
- [ ] make the missing-token line unconditional when tokens are unavailable, never omitted -> a smaller total cannot read as a cheaper run, which is the rule `references/meter.md` already states for unpriced agents

### Task 6: model tiers rather than model names

**Contract:** Needs: none | Offers: none
**Touches:** skills/sluice/scripts/plan.sh (edit) | skills/sluice/references/deep-channel.md (edit) | tests/sluice-plan.test.ts (test)

- [ ] add tests: a `**Model:** cheap, the contract is exact` line validates clean, and a line naming a provider-specific id such as `claude-sonnet-5` or `gpt-5` warns that the plan is not portable -> they fail, since the parser only records that the line exists
- [ ] have the parser read the Model line's text and emit a warning, not an error, when it matches a provider id pattern -> a plan naming a model still validates, and says why it should not
- [ ] update the `**Model:**` bullet in `deep-channel.md`'s plan format to specify the tier vocabulary (`cheap`, or omitted for the session's model) and to say a provider id makes the plan unportable -> the wording names the vocabulary at literal value

### Task 7: the router asks what it is running on

**Contract:** Needs: none | Offers: none
**Touches:** skills/sluice/SKILL.md (edit) | skills/sluice/references/deep-channel.md (edit) | tests/sluice-skill.test.ts (test)

- [ ] add tests: `SKILL.md` names the capability question at routing, and `deep-channel.md`'s dispatch-unavailable section is reachable as the normal path rather than described as an exception -> they fail against the current prose
- [ ] add a paragraph to `SKILL.md`'s routing section: state dispatch, worktree and token availability once, in the announcement, where a partner can still act on it, and record it with `status.sh capabilities` -> the new test passes and the paragraph names the command, not just the obligation
- [ ] rewrite the opening of `deep-channel.md`'s "When dispatch is unavailable" so it separates three cases rather than two: dispatch on request, dispatch withheld, and a harness with no subagents at all, where this is simply how deep runs -> the section reads as a supported path, and the review tier table's dispatch rows point at it

### Task 8: sluice installs on four harnesses

**Contract:** Needs: none | Offers: none
**Touches:** skills/sluice/skill.json (edit) | skills/index.json (edit) | tests/sluice-skill.test.ts (test)
**Flips:** sluice installs on cursor, codex and gemini, from Claude Code only
**Review:** the flip

- [ ] add a test asserting `skill.json` lists all four tools and carries an install block per tool, each with a `bundleRoot` -> it fails against `"tools": ["claude"]`
- [ ] add `cursor`, `codex` and `gemini` to `tools`, and an install block each: cursor `prompt: .cursor/rules/sluice.mdc` with `bundleRoot: .cursor/rules/sluice`, gemini `prompt: .gemini/sluice.md` with `bundleRoot: .gemini/sluice`, codex `prompt: AGENTS.md` with `append: true` and `bundleRoot: .agent-skills/sluice` -> the test passes
- [ ] drop the "Claude Code only" clause from the skill.json description and say which channels need dispatch instead -> the description no longer contradicts the manifest
- [ ] run `bun run scripts/build-index.ts` and commit the regenerated `skills/index.json` -> `release.sh`'s index gate would pass
- [ ] install into a scratch directory for each of the three tools and confirm the scripts land executable and `bash <root>/scripts/plan.sh validate` runs -> three real installs, not three declarations

### Task 9: the meter defers instead of reporting nothing

**Contract:** Needs: none | Offers: none
**Touches:** skills/sluice/scripts/run-stats.sh (edit) | skills/sluice/references/meter.md (edit) | tests/sluice-run-stats.test.ts (test)
**Review:** the exit-2 path is what every handback depends on

- [ ] add a test: with no transcript resolvable and a live `run.json` present, `run-stats.sh` points at `status.sh ledger` rather than exiting as though there were no run -> it fails, since exit 2 currently means "no run to report"
- [ ] separate the two meanings of the current exit 2: no announcement found in a transcript that exists, versus no transcript at all. The second is a harness fact, not a fact about the work -> the two print different messages
- [ ] update `references/meter.md` to say which ledger belongs to which harness, and that the portable one omits tokens by nature rather than by failure -> the rule names both commands

## Verification

End to end, in order:

1. `bun test` — 1161 baseline plus the new cases, 0 fail
2. `bun run scripts/audit-skills.ts` — 0 ERR, 0 WARN, 0 INFO
3. `bun run scripts/build-index.ts && git diff --quiet -- skills/index.json` — the release gate
4. Three real installs into scratch directories:
   `bun run src/cli/index.ts install sluice --tool cursor` (then codex, then gemini) into a temp dir, each followed by `ls` under the bundle root, `test -x` on both scripts, and `bash <root>/scripts/plan.sh validate docs/plans/2026-08-07-sluice.md` returning exit 2 with findings rather than a bash error
5. `bash skills/sluice/scripts/status.sh capabilities --dispatch no --tokens no` then `status.sh ledger` — a ledger with no token line missing and no jq error
6. `bash skills/sluice/scripts/plan.sh validate` on this plan once it is written to `docs/plans/` — it should pass its own checks, which is the point of having them
7. Remove each scratch install and confirm no files are left under the bundle root

## What this plan does not do

- No MCP server, and no attempt at one. Codex does not support MCP and the other two would need a running process, which is a different distribution model
- No change to magpie or migrate, though Task 1 through 3 unblock them the same way. Their bundles carry `bin/`, `package.json` and an `install.sh` that only the claude adapter runs, so they need the postinstall question answered separately
- No programmatic capability probe. The model states what it has and the file records it
- No release
