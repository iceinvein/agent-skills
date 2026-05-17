# PR Review Skill: Interactive Port of Pylon's PR Review Pipeline

Date: 2026-05-14
Status: Design (approved 2026-05-14, pending implementation)
Author: Dik Rana

## Motivation

Pylon's PR review feature is implemented as a programmatic, multi-agent pipeline that runs through the Claude Agent SDK from the Electron main process. With `claude -p` no longer covered by the Claude subscription, every programmatic call now bills against API usage. Running the full pipeline (5 specialist agents, dedupe, critic, peer review, optional revalidation) through the SDK becomes prohibitively expensive for daily PR review.

This design ports the pipeline to an interactive Claude Code skill so the review runs inside the user's active Claude Code conversation. Compute is paid for by the conversation's existing subscription budget; no out-of-band programmatic Claude calls are made. The skill preserves the staged-pipeline shape of the existing system so prompts, dedupe logic, and critic rubric port directly from Pylon's main-process code.

## Constraints

Three hard constraints shape the design:

1. **No programmatic Claude calls.** Every LLM call must use one of: the main Claude Code conversation, the in-harness `Agent` (Task) tool for subagents, or `codex exec` for cross-model peer review. Bundled scripts are pure code (no LLM calls inside).
2. **No mandatory cloud or daemon.** The skill runs locally. The only long-running process is a per-run HTML server, self-contained within the skill (no dependency on the superpowers brainstorming server).
3. **External dependencies are user-installed.** `bun`, `gh`, `codex`, `git` must be on PATH. The skill pre-flights them and fails loudly if any are missing.

## Goals

- Five-focus parallel review (security, bugs, performance, code-smells, architecture) with the same prompt content as Pylon today.
- Dedupe and critic noise-reduction stages with logic ported 1:1 from `src/main/pr-review-dedupe.ts` and `pr-review-critic.ts`.
- Cross-model peer review via `codex exec` (no in-Claude fallback).
- Interactive HTML report (two pages: progress + findings selection) served from a self-contained Bun server, with click-driven selection feeding back into the conversation.
- Auto-worktree at the PR's head SHA so specialists read the actual PR code, not the user's local checkout.
- Durable per-stage state so a crashed run can resume from the last completed stage without re-running specialists.

## Non-goals

- Incremental review across multiple runs against the same PR (Pylon's revalidation, thread lifecycle, baseline diffing). Out of scope for v1; every run is fresh.
- Cross-conversation review history. Each run is one conversation.
- Auto-posting all findings. Posting is always interactive, gated by browser selection.
- Eval harness for prompt quality. Prompts are inherited from Pylon (already battle-tested); eval-driven prompt tuning is a separate initiative.
- A way to feed skill-produced findings back into Pylon's SQLite DB. Optional future work via the parity-check script.

## Architecture

The skill is a slash command (`/pr-review`) backed by a short markdown file plus a small set of bundled Bun scripts.

```
┌──────────────────────────────────────────────────────────────────┐
│ Main agent (Claude Code conversation)                            │
│   parses user ask, identifies PR                                 │
│   dispatches and supervises stages                               │
│   calls bundled scripts via Bash                                 │
│   reads HTML selection events on user reply                      │
└──────────────────────────────────────────────────────────────────┘
            │ Task tool (parallel)                  │ Bash
            ▼                                       ▼
┌────────────────────────────┐    ┌──────────────────────────────┐
│ Specialist subagents x5    │    │ Bundled scripts (Bun)        │
│   security                 │    │   server.ts                  │
│   bugs                     │    │   dedupe.ts                  │
│   performance              │    │   render.ts                  │
│   code-smells              │    │ Plus plain Bash:             │
│   architecture             │    │   gh, git worktree, codex    │
│ Each writes findings.json  │    └──────────────────────────────┘
│ to durable run directory   │
└────────────────────────────┘
```

### Pipeline stages

1. **Setup.** Pre-flight dependencies, run `gh pr view` and `gh pr diff`, create worktree at PR head SHA.
2. **Context (optional).** If code-intelligence MCP is connected, the main agent builds `pr-context.json` (changed symbols, references, tests). Skipped silently if MCP is absent.
3. **Specialists (parallel).** Five Task subagents dispatched in one message, each writes `findings/<focus>.json`.
4. **Dedupe.** Bun script merges five files into one deduped set using the Pylon fingerprint algorithm.
5. **Critic.** Main agent applies the Pylon critic rubric in-conversation, writes `findings.kept.json`.
6. **Peer review.** `codex exec` runs the peer-review prompt against the kept set, returns verdicts (keep / drop / downgrade). Main agent applies them.
7. **Report.** `render.ts` produces `progress.html` (already pushed during stages 3-6) then `findings.html`. `server.ts` serves both.
8. **Post.** User selects in browser, sends a terminal message ("post"), main agent reads `state/events` and posts via `gh`.

### State location

Run directory: `~/.pylon-review/<run-id>/`, where `<run-id>` is `pr-<number>-<unix-timestamp>`.

Global rather than project-local so:
- Concurrent runs across repos do not collide.
- Findings outlive `git clean -fdx` in the project.
- The user can inspect old runs without cd'ing into the repo.

Worktree lives at `<run-dir>/worktree/`, cleaned at end of run.

### Run directory layout

```
~/.pylon-review/<run-id>/
  pr.json                      # gh pr view output
  diff.patch                   # gh pr diff output
  pr-context.json              # optional, if MCP available
  worktree/                    # git worktree at PR head SHA
  findings/
    security.json
    bugs.json
    performance.json
    code-smells.json
    architecture.json
  findings.deduped.json
  findings.kept.json           # after critic
  findings.final.json          # after peer review
  screen/
    progress.html
    progress-v2.html           # newest file wins, never overwrite
    findings.html
  state/
    server-info                # {url, port, pid}
    events                     # JSONL click/submit events
    server-stopped             # exists when server has exited
  log.jsonl                    # one line per stage transition
```

## Components

### Skill markdown (`pr-review.md`)

The slash command file Claude Code loads. Contents:

- One-paragraph purpose statement.
- Prerequisites list (bun, gh, codex, git).
- Ordered stage walkthrough with the exact Bash invocations for each script subcommand.
- Inline specialist prompts (one per focus, ported verbatim from `pr-review-prompts.ts`).
- Inline critic rubric (ported from `pr-review-critic.ts`).
- Inline peer-review prompt template (ported from `pr-review-peer-review.ts`).
- Resume instructions (what to do if the user re-invokes mid-run).

Short and instructional. The main agent reads it top-to-bottom and follows.

### Bundled scripts

Single CLI entry point: `bin/pr-review` (Bun-compiled binary or a `bun run` shim).

Subcommands:

- `pr-review setup <run-dir> --pr <n>` runs pre-flight, fetches PR, creates worktree, writes `pr.json` and `diff.patch`.
- `pr-review serve <run-dir>` starts the HTML server, prints `{url, port, state_dir, pid}` JSON, runs in background. Routes:
  - `GET /` serves the newest file in `screen/`.
  - `POST /events` appends a JSON line to `state/events`.
  - `POST /heartbeat` resets the 30-minute idle timer.
  - `GET /favicon.ico` returns 204.
  Server injects an inline helper script into HTML responses for click capture.
- `pr-review dedupe <run-dir>` reads `findings/*.json`, writes `findings.deduped.json`. Pure port of `src/main/pr-review-dedupe.ts`.
- `pr-review render <run-dir> <page>` writes `screen/progress.html` or `screen/findings.html` from current run state. Each render writes a new file (e.g. `progress-v2.html`, `progress-v3.html`) so the server always picks the newest by mtime.
- `pr-review cleanup <run-dir>` removes the worktree, stops the server, archives the run directory (kept on disk, not deleted).
- `pr-review status <run-dir>` reads `log.jsonl`, prints the highest completed stage; used by the resume path.
- `pr-review --list-runs` and `pr-review --cleanup-run <id>` for housekeeping.

Supporting files inside the skill:

- `scripts/server.ts`: Bun.serve implementation.
- `scripts/dedupe.ts`: port of `pr-review-dedupe.ts`.
- `scripts/render.ts`: HTML template-literal renderer.
- `scripts/types.ts`: shared types matching Pylon's `ReviewFinding` shape.
- `scripts/helper.js`: client-side click-capture and "post selected" button handler, inlined by `server.ts` into HTML responses.

### Specialist subagents

Dispatched via the `Agent` tool with `subagent_type: "general-purpose"`. No declared subagent definitions (no `agents/` directory), no YAML coordination. Each subagent's prompt is built by the main agent from the skill markdown plus the run-dir paths.

Per-subagent prompt contract:

- Specialist instructions for the focus area (from the markdown).
- Absolute paths: cd into `<run-dir>/worktree`, read `<run-dir>/diff.patch`, optionally read `<run-dir>/pr-context.json` if it exists.
- Output contract: write findings to `<run-dir>/findings/<focus>.json` before returning. Return a one-line summary.
- Tool guidance: prefer code-intelligence MCP if available, fall back to Read and Grep otherwise.

### Critic stage

Runs as a main-agent step, not a subagent. Main agent reads `findings.deduped.json`, applies the Pylon critic rubric, writes `findings.kept.json` via Write. Done in the main conversation because the rubric benefits from the agent's existing pipeline context (knows what specialists ran, knows what context was available).

### Peer-review stage

The main agent writes the peer-review prompt to `<run-dir>/peer-prompt.md` (kept findings plus the verdict-template instruction). Runs:

```
codex exec --file <run-dir>/peer-prompt.md > <run-dir>/peer.json
```

Codex returns structured verdicts. Main agent parses, applies them (keep / drop / downgrade) to produce `findings.final.json`.

### HTML report

Two templates rendered by `render.ts`:

- `progress.html`: stage strip across the top (setup, context, specialists, dedupe, critic, peer review, report, post), live finding counts per specialist, run metadata (PR number, head SHA, branch). Re-rendered after each stage transition.
- `findings.html`: grouped finding list (default by file, toggle to by-severity). Each finding card has a checkbox, severity chip, title, collapsed description, expandable diff snippet, expandable suggestion. Footer has a "Post selected (N)" button that emits a `submit` event to `state/events`.

After posting, `findings.html` is re-rendered so the user sees "posted" and "failed" badges on items that came back from `gh`.

## Flow

### Happy path

1. User invokes the skill: "Review PR 1234" or pastes a PR URL. Main agent parses the identifier; asks one clarifying question if ambiguous.
2. Agent runs `pr-review setup ~/.pylon-review/pr-1234-1736870000 --pr 1234`.
3. Agent runs `pr-review serve <run-dir>` with `run_in_background: true`. Reads `state/server-info` for URL. Prints "Open <url>" to the user. Runs `pr-review render <run-dir> progress` for the first paint.
4. Agent checks if `mcp__code-intelligence__search_code` is available. If yes, builds `pr-context.json`. If no, skips with a log line. Re-renders progress.
5. Agent dispatches five Task subagents in one message (parallel). Each prompt includes specialist instructions, paths, and output contract.
6. Agent awaits all five Task results. Re-renders progress after each subagent returns. Records per-focus status.
7. Agent runs `pr-review dedupe <run-dir>`. Re-renders progress.
8. Agent applies critic rubric in-conversation, writes `findings.kept.json`. Re-renders progress.
9. Agent writes peer-prompt.md, runs `codex exec`, applies verdicts, writes `findings.final.json`. Re-renders progress.
10. Agent runs `pr-review render <run-dir> findings`. Prints to terminal: "Findings ready at <url>. Click checkboxes to select what to post, then reply with `post`." Ends turn.
11. User clicks checkboxes in the browser. Each click writes a line to `state/events`. User types `post` (or `post 1,3,7` for explicit indices) in the terminal.
12. Agent reads `state/events`, resolves the latest selection set (union of `select` events minus `deselect`), posts via `gh pr review` or the line-anchored review comments API (matching Pylon's `gh-cli.ts` shape). Re-renders `findings.html` to show badges.
13. Agent runs `pr-review cleanup <run-dir>`. Worktree removed, server stopped, run directory archived (kept on disk). Final summary printed.

### Resumption

If the user re-invokes the skill and a `state/server-info` exists for an in-progress run, the agent calls `pr-review status <run-dir>`, reads `log.jsonl` to find the highest completed stage, and resumes from the next stage. Specialist crashes mid-dispatch: agent re-dispatches only the missing focuses (those without a findings file).

### Abort

User types `abort` in the terminal at any pre-post stage. On next agent turn, agent detects, runs cleanup, exits. If the user closes the conversation entirely, run directory remains on disk for manual cleanup via `/pr-review --cleanup-run <id>`.

### Concurrent runs

Distinct run-ids and ports (server binds to port 0, reports the chosen port). No shared state; no collision detection. Running the skill twice against the same PR produces two distinct runs; that is intended behavior.

## Error handling

| Stage | Failure | Behavior |
|-------|---------|----------|
| Setup | Missing binary | Script exits non-zero with single install hint line. Agent surfaces verbatim. No run directory created. |
| Setup | `gh pr view` or `gh pr diff` fails | Script exits non-zero. Agent stops. No worktree (setup is atomic). |
| Setup | Worktree create fails | Script cleans partial state, exits non-zero. No fallback to diff-only. |
| Context | MCP build fails | Soft. Log `{stage: context, status: skipped, reason}`. Continue. |
| Specialists | Single subagent returns no findings file | Record `{focus, status: error}`. Continue with remaining focuses. |
| Specialists | Single subagent returns malformed JSON | Dedupe skips file with parse-error log. Treat as zero findings for that focus. |
| Specialists | All five fail | Hard stop. Cleanup runs. User sees pointer to `log.jsonl`. |
| Dedupe | Script crash or unreadable inputs | Stop. Cleanup. Findings preserved for inspection. |
| Critic | Main-agent error | Retry once. If still failing, fall through to peer-review using `findings.deduped.json` directly. Report header shows "critic skipped" badge. |
| Peer review | Codex auth or network failure | Surface stderr. Prompt user once: "Skip peer review and proceed, or abort?" If skipped, copy kept set to final set; report header shows "peer-review skipped" badge. |
| Peer review | Malformed verdicts | Retry `codex exec` once. If still malformed, same fallback as above. |
| Server | Port bind fails | Script exits non-zero. Stop. Cleanup. |
| Server | Server dies mid-run | Next render call detects missing `server-info` or presence of `server-stopped`. Restart server, write latest HTML, print new URL. |
| Server | 30-min idle timeout | Server self-exits. Agent restarts on next user engagement. |
| Post | Single `gh` post fails | Append `post-failed` event for that finding. Next render shows "failed" badge. No automatic retry. |

Every stage transition writes a JSON line to `log.jsonl`: `{stage, status, started_at, finished_at, details}`. Errors append `{stage, status: error, error: <message>}`. `/pr-review --logs <run-id>` exposes the log for inspection.

## Testing

### Automated (`bun test`)

- **`dedupe.ts`**: port the existing `src/main/__tests__/pr-review-dedupe.test.ts` cases (or close equivalents). Same fingerprint, same clustering, same edge cases.
- **`render.ts`**: snapshot tests against `findings.html` and `progress.html` for fixture sets: zero findings, mixed-severity findings, finding with suggestion, posted/failed badges.
- **`server.ts`**: integration test that boots the server on port 0, writes a screen file, fetches `GET /`, posts an event to `POST /events`, asserts the event landed in `state/events`. Heartbeat and idle-timeout tested with a shortened timer override.
- **`bin/pr-review setup`**: mocked via injected `$GH_BIN` and `$GIT_BIN` env vars pointing to fixture scripts that return canned PR JSON and diff. Asserts run-directory layout, worktree creation call sequence, pre-flight failure paths.
- **`bin/pr-review cleanup`**: asserts worktree removal, server stop signal, archive directory created.

### Pipeline-level integration test (one)

End-to-end deterministic stages against a fixture run-dir: `setup` (mocked), pre-baked `findings/<focus>.json` files, `dedupe`, `render`, `cleanup`. No specialists, no critic, no codex, no main agent. Catches the "stages do not compose" class of regression.

### Skill markdown lint

A `bun test` script that loads `pr-review.md`, asserts:

- Every documented stage references the correct script subcommand.
- Specialist prompts contain the literal output-contract sentence ("write findings to `<run-dir>/findings/<focus>.json`").
- Codex peer-review prompt round-trips through `codex --dry-run` (if available) without parse errors.

### Manual verification checklist

Kept in this spec, not automated:

- Real PR, all five specialists, MCP available: full happy path.
- Real PR, MCP disconnected: context-skip path.
- Real PR, codex not authed: peer-review-skip prompt.
- Concurrent runs in two terminals against different PRs: port isolation, run-dir isolation.
- User clicks select, then deselect, then submit: events stream correctness.
- User selects findings, types `post`, gh returns 422 on one finding: partial-failure badges.
- Resume after killing the server mid-specialists: log-replay correctness.

### Out of scope for testing

- Specialist subagent prompt quality (eval-driven, separate initiative).
- Critic rubric filtering decisions (ported verbatim from Pylon, already has track record).
- Codex peer-review prompt verdicts (same).

### Optional parity check

A standalone script `scripts/parity-check.ts` takes a recorded Pylon review run (findings JSON exported from the SQLite DB) and runs the skill's dedupe and critic rubric over the same raw inputs. Asserts the kept set matches within a small tolerance. Useful for regression-checking when porting future Pylon prompt or logic changes back into the skill. Not part of CI.

## Open questions

None identified at the design stage. Implementation may surface tactical questions (exact `gh` posting endpoint shape per finding type, codex output schema stability across versions, HTML helper-script CSP requirements) that will be resolved during the plan phase.

## Future extensions (not in scope)

- Incremental review: thread lifecycle, baseline diffing, revalidation pass.
- Pylon read-back: persist skill-produced findings into a format Pylon can ingest.
- Per-user defaults: persist focus selection in `~/.pylon-review/config.json`.
- Auto-post flag for trusted contexts.
- Eval harness for specialist prompt quality.
