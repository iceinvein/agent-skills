# `sluice` — Design

**Date:** 2026-08-07
**Status:** Approved, ready for planning

## Goal

A skill that routes work by change shape into four channels, each mandating only
the rules that channel needs. It replaces the superpowers plugin's single
mandatory pipeline, which charges every task the cost of the largest task.

Target: ~20 tokens always-on, ~600 tokens on invoke, no forced user round-trips
below the deep channel.

## Name

A sluice box sorts material by size into separate channels; a sluice gate meters
how much flows through. Both halves of this design live in one concrete object.
The channel names are the sluice's own vocabulary.

## Motivation

Superpowers 6.2.0 (14 skills, ~70k tokens on disk) routes all creative work
through one pipeline: `brainstorming` → `writing-plans` → `subagent-driven-development`
→ `finishing-a-development-branch`. That path costs ~14k tokens of skill content
and at least four user round-trips before any code is written, and it produces two
committed markdown documents plus roughly six per-task artifacts.

The pipeline is defensible for a multi-week feature. It has no scale-down path.
`brainstorming` carries a `<HARD-GATE>` and an explicit anti-scaling section
("A todo list, a single-function utility, a config change — all of them"), and it
terminates only at `writing-plans`. A one-line config change nominally pays the
full cost.

Three further sources of weight, measured against superpowers 6.2.0:

1. **Harness obsolescence (~11k tokens).** `using-git-worktrees` (1.7k) reduces to
   its own Step 1a, "if you have a tool like `EnterWorktree`, use it".
   `executing-plans` (576) exists only as the no-subagents fallback.
   `subagent-driven-development` (7.0k) hand-rolls a ledger and three shell
   scripts to do what the Task and Agent tools do natively.
   `dispatching-parallel-agents` (1.5k) restates harness-prompt content. Four
   platform reference files (2.3k) target other harnesses, and one of them
   (`gemini-tools.md`, 1.1k) is not referenced from any SKILL.md.
2. **Duplication.** "Common Rationalizations" tables appear in 7 skills;
   "Red Flags" sections in 7. The delegation paragraph beginning "You delegate
   tasks to specialized agents with isolated context" is verbatim identical in
   `dispatching-parallel-agents:10` and `subagent-driven-development:10`.
3. **Non-instructional files shipped inside skill directories (~15k tokens).**
   `writing-skills/anthropic-best-practices.md` is 11.5k tokens, and the
   superpowers `CLAUDE.md` states the project disagrees with it.
   `systematic-debugging/` ships `CREATION-LOG.md` and four eval fixtures
   (`test-pressure-1/2/3.md`, `test-academic.md`, ~2.9k).

Five rules in superpowers demonstrably shape behaviour and survive the cut. They
are all short. Everything else is scaffolding around them.

## Architecture

One skill directory. The router is the SKILL.md; the five rules and the plan
template are reference files loaded on demand.

```
skills/sluice/
  SKILL.md            ~600 tok   router: channel table, one-line rules, deep-channel exec
  skill.json                     manifest + claudeHookDirective
  references/
    intent.md         ~250 tok   agree on intent before building
    test-first.md     ~300 tok   write the failing test, watch it fail
    root-cause.md     ~300 tok   root cause before fix; 3 fixes = architecture
    verify.md         ~250 tok   evidence before completion claims
    review.md         ~350 tok   fresh-context review, diff handed over as a file
    plan-template.md  ~250 tok   plan artifact shape (deep channel only)
```

This matches `skills/magpie/`'s layout in this repo (SKILL.md + `references/`).

### Rules are one-liners in the router

The router states each rule in one line. The reference file carries the
pressure-testing — rationalization tables, red-flag lists, worked examples — and
is read **only on friction**: when the agent notices itself wanting to skip the
rule, or when a rule is being applied for the first time in a session.

This is what makes the fast channel cheap. Most fast-channel work reads the router
and nothing else. It also isolates the expensive, repetitive content to the moment
it is needed, rather than paying for it on every invocation.

### Channel table

| Channel | Signal | Rules | Announce | Typical cost |
|---------|--------|-------|----------|--------------|
| `bypass` | No code change | none — just answer | nothing | ~15 tok |
| `fast` | Existing interfaces, one subsystem | test-first, verify | "Fast channel. Test first, then implement." | ~600 tok |
| `main` | New interface, or crosses subsystems | + agree intent, review before merge | "Main channel — new interface. Agreeing the shape first." | ~600 tok |
| `deep` | Several subsystems, or user asks for a plan | + written design and plan | "Deep channel — several subsystems. Design before code." | ~600 tok + refs on friction |

`bypass` announces nothing. Silence is what keeps a question a question — it fixes
a specific superpowers failure, whose `using-superpowers` rationalization table
asserts "Questions are tasks. Check for skills," routing a pure question into the
pipeline.

**`root-cause` is not channel-assigned.** It is trigger-based and cross-cutting: it
fires on any bug, test failure, or unexpected behaviour, in every channel including
`bypass`. Channels govern how much process a *change* carries; a bug demands
root-cause investigation whether it surfaced during a one-line fix or a
multi-subsystem build. The other four rules are channel-assigned as tabulated.

Criteria are change-shape signals, not size thresholds. Whether a change adds a
new interface or crosses a subsystem boundary is knowable before writing code;
a diff's line count is not, so a size-based router would be guessing at exactly
the moment it must decide.

### Routing contract

- The agent picks the channel, **states it in one line**, and proceeds. The
  announcement is the escape hatch — it is how the user redirects without being
  asked to confirm.
- `bypass`, `fast`, and `main` never stop for approval. `deep` stops for design
  sign-off before code.
- **Escalation is explicit.** If a fast-channel task turns out to need a new
  interface, the agent says so and re-routes. Silently finishing in the wrong
  channel is the failure this prevents. Dropping to a shallower channel mid-task
  is not permitted without saying so.
- Explicit user instruction always wins. "Just do it" collapses to `fast`
  regardless of signal.

### Deep-channel execution

Replaces `subagent-driven-development` (7.0k) with roughly 150 tokens:

- One `TaskCreate` entry per task.
- Fresh `Agent` per task, given the task text rather than session history.
- `git diff > file`; the reviewer receives the path, never a pasted diff.
- Review before starting the next task.

No ledger file, and none of the `sdd-workspace` / `task-brief` / `review-package`
scripts. The Task tools cover progress tracking and the Agent tool covers dispatch.

### Document locations

The deep channel writes to `docs/specs/YYYY-MM-DD-<topic>.md` and
`docs/plans/YYYY-MM-DD-<topic>.md`.

Unnamespaced deliberately. Superpowers hardcodes `docs/superpowers/specs/` and
`docs/superpowers/plans/`, and this repo's `.gitignore` fences off
`docs/superpowers` — a tool that names a directory after itself invites exactly
that. An existing repo convention or a stated user preference overrides the
default.

### Always-on activation

`skill.json` declares:

```json
"activation": {
  "modes": ["session", "global"],
  "default": "global",
  "claudeHookDirective": "Before acting on a request that changes code, pick a sluice channel and state which one."
}
```

The installer wires this into a SessionStart hook (`src/cli/adapters/claude.ts:30`,
`wireSessionStartHook`). It injects a short directive string, not a file, costing
roughly 20 tokens per session. Superpowers' equivalent hook injects
`using-superpowers/SKILL.md` verbatim at ~765 tokens.

Default is `global`, unlike `terse`'s `session`. A router that is not always on
does not route.

## The five rules

Four are channel-assigned; `root-cause` is cross-cutting and trigger-based. Each
reference file carries the rule, why it holds, and the specific rationalizations
that precede breaking it.

**All prose is original.** The underlying ideas are common engineering practice
and free to state; the wording is written fresh rather than derived from
superpowers. That keeps the skill clear of any third-party licence obligation,
so it ships no NOTICE and attributes nothing. The cost is losing superpowers'
eval-tuned phrasing, which is accepted deliberately.

1. **`intent.md`** — Agree on what is being built before building it. Ask
   questions one at a time; propose approaches with a recommendation. Scaled to
   the channel: `main` agrees in one chat message, `deep` writes it down. No hard
   gate.
2. **`test-first.md`** — Write the failing test, watch it fail, then write the
   minimal code. The load-bearing claim: if you did not watch it fail, you do not
   know it tests the right thing.
3. **`root-cause.md`** — Find the root cause before fixing. Three failed fixes
   means the architecture is wrong, not the hypothesis. Cross-cutting: triggered
   by a bug or test failure in any channel, not assigned to one.
4. **`verify.md`** — Run the command before claiming it passes. Evidence before
   assertions.
5. **`review.md`** — Before merge, dispatch a reviewer with fresh context. Hand
   over the diff as a file so it lands in the reviewer's context and not the
   coordinator's.

## The plan template

`references/plan-template.md` is an artifact shape, not a sixth rule, which is why
it sits outside the five. It is read only when the deep channel reaches planning.

It is load-bearing rather than decorative: deep-channel execution dispatches a
fresh `Agent` per task with the task text and no session history, and an agent
with no session context cannot work from a task that fails to state its own file
paths and interfaces. Without the template the deep channel degrades to pasting
session history into dispatches, which is the thing the execution model exists to
prevent.

Kept from superpowers' `writing-plans`:

- Exact create / modify / test paths per task
- **Interfaces block** (consumes / produces, exact signatures) — what makes a
  context-free agent viable
- The no-placeholders rule
- A Global Constraints section

Dropped: the five boilerplate TDD steps written out per task, full code blocks for
every step, the "which execution mode?" menu, and the mandatory announce string.

## Deliberately absent

- **Worktrees.** The harness provides `EnterWorktree`.
- **Parallel dispatch guidance.** Already in the harness prompt.
- **Skill-authoring content.** Belongs in its own skill, not in a workflow router.
- **Tone policing** around how to phrase review replies.
- **Platform detection** and the no-subagent fallback path. Claude Code only.
- **Rationalization tables in the router.** They live in the reference files,
  read on friction.

## Constraints

- **Claude Code only.** `skill.json` declares `"tools": ["claude"]`. The repo
  supports Cursor, Codex, and Gemini CLI; this skill does not, because dropping
  the portability layer is the largest single source of the savings.
- **Cannot coexist with superpowers.** The superpowers SessionStart hook mandates
  `brainstorming` before any creative work, which overrides the router on exactly
  the fast path this skill exists to open. Installing `sluice` means disabling
  superpowers. This must be stated in both the README row and SKILL.md.
- **Audit invariants.** `bun run skill:audit` requires `skill.json`, `SKILL.md`,
  an `index.json` entry, and a README row. Frontmatter is capped at 1024 chars
  (`scripts/audit-skills.ts:74`). There is no SKILL.md size cap.
- **Version** `1.0.0`.

## Success criteria

1. A one-line change ("add a `--json` flag") completes with zero approval
   round-trips and no written documents.
2. A multi-subsystem request still produces a design and a plan before code.
3. Always-on session cost is under 50 tokens.
4. Fast-channel invocation cost is under 800 tokens.
5. `bun run skill:audit` passes clean.
6. The agent states its channel on every code-changing request, stays silent on
   `bypass`, and re-states when escalating.

## Testing

The repo's `tests/` cover installer behaviour, and `skill:audit` covers manifest
invariants. Both apply here. Behavioural claims — that the router picks the right
channel and that it announces — are not covered by either, and this design does
not introduce a harness for them. Routing behaviour will be checked by hand
against the six success criteria above before release.
