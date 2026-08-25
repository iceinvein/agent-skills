# Design: sluice on four harnesses

Sluice declares `"tools": ["claude"]`. The reason is not a policy choice, it is a
gap in the installer, and this session found it by reading the adapters rather
than assuming: **`bundleRoot` is implemented only in `src/cli/adapters/claude.ts`
(lines 139-152)**, along with `shouldBeExecutable` (lines 5-10) and the
`postinstall` hook. `cursor.ts` and `gemini.ts` write `prompt` plus an explicit
`supporting` map plus MCP config, and nothing else. `codex.ts` appends the prompt
into `AGENTS.md` and writes no files at all.

That single gap explains the whole distribution pattern: 33 of the 36 skills
declare all four tools, and the three that do not are exactly the three that
bundle a directory of scripts and references, magpie, migrate and sluice. A
prose-only skill goes everywhere already. A skill with a bundle cannot.

I told you earlier that adding the other three targets was "a skill.json edit,
not new infrastructure". That was wrong. The skill.json edit is the last task
here, and it only works because three adapters get a bundle writer first.

The second half is what sluice does once it arrives somewhere else. Two things
break by construction: the deep channel is built on subagent dispatch, which no
other harness has, and `scripts/run-stats.sh` reads the session transcript from
`$CLAUDE_CODE_SESSION_ID` under `${CLAUDE_CONFIG_DIR:-~/.claude}/projects/`,
falling back to `~/.claude/projects/` so a machine that has run under both
profiles still resolves. No other harness writes either location.
Neither problem is fixed by shipping files.

Decisions taken before writing this: deep **degrades** rather than disappearing,
reusing the "When dispatch is unavailable" section `deep-channel.md` already
carries, promoted from an exception to the normal path off Claude Code. Codex
**keeps its `AGENTS.md` append** and gains a bundle beside it, so the router is
the always-on entry point and the 21KB of references stay on disk to be read by
path.

Intended outcome: `agent-skills install sluice --tool cursor|codex|gemini` puts a
working sluice on those harnesses, with the channels that need dispatch honest
about not having it, and a ledger that reports what it can measure instead of
nothing.

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

## Decisions taken, and what they rule out

**Deep degrades rather than disappearing.** On a harness with no subagents, the
plan becomes a worklist, the run record carries all the state that would have
lived in task isolation, and review is listed outstanding rather than passed.
`references/deep-channel.md` already carries that treatment; this promotes it
from an exception to the normal path. The alternative considered was routing deep
to main, which throws away the plan and the task graph, and those still help a
single implementer working alone.

**Codex keeps its AGENTS.md append and gains a bundle beside it.** The router is
always in context there, which costs 8.7KB, and the 21KB of references stay on
disk to be read by path. A trimmed second copy of the router was considered and
rejected: it forks the prose into two versions that drift, which is the failure
this whole line of work has been closing.

**Capability is recorded, not probed.** No script can reliably ask a harness what
it offers. The model knows its own tool list, states it, and `run.json` holds the
answer. That is the same shape as the pre-flight rows: the file's job is to let a
later reader tell the question was asked.

## What this design does not cover

- No MCP server, and no attempt at one. Codex does not support MCP and the other two would need a running process, which is a different distribution model
- No change to magpie or migrate, though Task 1 through 3 unblock them the same way. Their bundles carry `bin/`, `package.json` and an `install.sh` that only the claude adapter runs, so they need the postinstall question answered separately
- No programmatic capability probe. The model states what it has and the file records it
- No release
