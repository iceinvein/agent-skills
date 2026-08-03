---
name: magpie
description: Use when the user asks to review a GitHub pull request (a PR number, PR URL, or "review this PR"). Interactive PR review pipeline; five parallel specialist subagents, dedupe, critic, codex/Claude peer review, and an interactive HTML report for posting selected findings via gh. Follow the stage walkthrough in this skill; the description is not the procedure.
---

# Magpie

## Prerequisites

The skill pre-flights `bun`, `gh`, `git` (required) and `codex` (optional). If a required binary is missing the run aborts with a single install hint line. `codex` is the preferred peer reviewer, but it is optional: if it is missing the run continues and the peer-review stage falls back to a Claude second-opinion subagent (setup prints a one-line notice and logs `{stage: preflight, status: done, missingOptional: ["codex"]}`).

## Stage walkthrough

Stop reading and follow these steps in order. Do not skip stages. Use the exact Bash invocations below.

### 0. Identify the PR

Parse the user's request for a PR number, URL, or "this PR" (current branch). If ambiguous, ask one clarifying terminal question. Capture the PR number into `$PR_NUMBER` and the repository path into `$REPO` (default: current working directory).

Then check whether an earlier run on this PR is still unfinished, before minting a new id:

```
magpie --list-runs
```

Each line is `<id>\t<active|archived>\t<path>`. If an `active` id matches `pr-${PR_NUMBER}-*`, that run was interrupted rather than cleaned up. Set `RUN_DIR` to its path and go to "Resuming a crashed run" instead of starting over; ask the user first if it is unclear whether they want to resume or review from scratch. (`archived` ids are finished runs, not resumable.)

Otherwise compute a fresh run directory:

```
RUN_ID="pr-${PR_NUMBER}-$(date +%s)"
RUN_DIR="$HOME/.magpie/$RUN_ID"
```

### 1. Setup

```
magpie setup "$RUN_DIR" --pr $PR_NUMBER --repo "$REPO"
```

If exit is non-zero, surface stderr verbatim and stop. The CLI removes the worktree and subdirs on failure; the run directory itself plus `log.jsonl` are kept for diagnostics.

Setup automatically filters lockfiles, build output, generated source, and snapshot fixtures from `diff.patch` before specialists see it. Users can override by placing `.magpie.json` at the repo root: `{"exclude": [...glob], "include": [...glob], "useDefaults": true|false}`. When anything is filtered, the raw diff is preserved as `$RUN_DIR/diff.full.patch` and the exclusion list as `$RUN_DIR/excluded-files.json`.

When a prior run exists for the same PR (active or archived under `~/.magpie/`), setup writes `$RUN_DIR/incremental.json` with `{previousRunId, previousSha, currentSha, sameSha}`. The post stage surfaces this as a "Incremental review since `<sha>`" trailer on the summary comment.

Setup also runs a deterministic test-coverage check: when the diff contains zero test or spec files anywhere, each non-test source file with `>= 10` added code lines gets a `domain: "tests"` finding written to `$RUN_DIR/findings/tests.json`. This is a sixth domain that flows through dedupe/critic/peer-review alongside the five LLM specialists. No specialist subagent is dispatched for it.

### 2. Serve

Start the HTML server in the background using the Bash tool with `run_in_background: true`:

```
magpie serve "$RUN_DIR"
```

Read `$RUN_DIR/state/server-info` for the URL; the server writes it asynchronously at startup, so if the file doesn't exist yet, wait a moment and re-read (it appears within ~1s). Print to the user: "Open <url> in your browser to follow along."

The server shuts down after 30 minutes with no requests (an open report tab heartbeats every 30s, so it stays up while the user is looking at it) and deletes `state/server-info` on the way out. Nothing in the pipeline depends on it staying alive: re-run `magpie serve "$RUN_DIR"` to bring the report back.

Render the first progress paint:

```
magpie render "$RUN_DIR" progress
```

### 3. Context

Append `{stage: context, status: running}` to `$RUN_DIR/log.jsonl` and re-render progress. This stage has two steps and never aborts the run.

**Bind probe.** If the `mcp__code-intelligence__*` tools are not in your tool list, skip straight to the scout with `CODE_INTELLIGENCE=unavailable`. Otherwise call `bind_workspace` with `$RUN_DIR/worktree`. The worktree is a linked git worktree, so an already-indexed base repo seeds its index instead of re-indexing.

- `consent_required` means the base repo has never completed an index. **Never call `approve_indexing`**: that is a full GPU pass the user did not ask for. Set `CODE_INTELLIGENCE=unavailable`, and print one line: "Code intelligence is unavailable (the base repo has no index); specialists will review from the diff alone."
- `indexing_started` or `indexing_in_progress` means the seed took. Poll `get_index_stats` every 5s for at most 60s, then set `CODE_INTELLIGENCE=available` either way. Do not block the pipeline on completion; the specialist contract handles a still-indexing tool.
- A ready result sets `CODE_INTELLIGENCE=available`.
- Any other error sets `CODE_INTELLIGENCE=unavailable`. Do not retry.

**Scout.** Read `references/scout.md` and dispatch one subagent (Agent tool, `general-purpose`) carrying the `magpie-scout` block with `<<RUN_DIR>>`, `<<PR_NUMBER>>`, and `<<CODE_INTELLIGENCE>>` substituted. It writes `$RUN_DIR/brief.json`.

Append `{stage: context, status: done, codeIntelligence: true|false}` and re-render progress. If the scout returned without writing `brief.json`, append `{stage: context, status: skipped}` instead and continue: the brief is optional everywhere it is read.

### 4. Specialists

Read `references/specialists.md` now, before dispatching anything. It holds the five focus blocks and the output contract that every specialist prompt is built from. Assemble the prompts from that file verbatim: prompts written from memory drift off the JSON contract, and `magpie dedupe` drops findings it cannot parse.

Append `{stage: specialists, status: running}` to `$RUN_DIR/log.jsonl` and re-render progress, so the served page shows the stage as active rather than "Paused". Then dispatch the five specialist subagents in a single message using five Agent tool calls in parallel, one per focus in (security, bugs, performance, code-smells, architecture), each carrying the prompt that `references/specialists.md` describes.

After each subagent returns, append `{stage: specialist, focus: <focus>, status: done, findings: <count>}` to `$RUN_DIR/log.jsonl` and re-render progress. (Per-focus `specialist` entries are diagnostic; only the aggregate `specialists` entry advances `magpie status`.)

If all five specialists fail (no findings files written), log `{stage: specialists, status: error}` and stop. Otherwise mark `{stage: specialists, status: done}`.

### 5. Dedupe

```
magpie dedupe "$RUN_DIR" [--threshold <0-10>]
```

`magpie dedupe` also runs a deterministic evidence check against the worktree: findings whose `file` is missing or whose `line` is out of range are dropped. Drops are logged and recorded to `$RUN_DIR/evidence-dropped.json`. The check is skipped if the worktree is no longer present (archived run replay).

Each finding receives a derived 0-10 `score` from its risk fields. Findings below `--threshold` (default 3) are dropped before the critic LLM runs and recorded to `$RUN_DIR/threshold-dropped.json`. Pass `--threshold 0` to keep everything.

Re-render progress.

### 6. Critic

Read `references/critic.md` and `$RUN_DIR/findings.deduped.json`. Substitute both placeholders in the critic rubric (the compact candidate list including each finding's `onChangedLine`, and the `<<DIFF_EXCERPT>>` hunks for the referenced files), then apply the rubric verbatim (one verdict per finding). Write the kept subset to `$RUN_DIR/findings.kept.json`. Append `{stage: critic, status: done}` and re-render progress.

### 7. Peer review

Append `{stage: peer-review, status: running}` to `$RUN_DIR/log.jsonl` and re-render progress. This stage always runs. `codex` is the preferred reviewer because it is a different model from the Claude agents that produced the findings; when `codex` is unavailable, a Claude second-opinion subagent stands in.

Build the peer-review prompt first: read `references/peer-review.md`, take the `magpie-peer-review` block from it, and substitute the placeholders listed in that file's `## Substitute before use` preamble. Write the substituted prompt to `$RUN_DIR/peer-prompt.md`.

**Codex path (preferred).** If `codex` is available (setup did not log `missingOptional: ["codex"]` and `command -v codex` succeeds), set `<<PEER_PROVIDER>>` to `codex` and run codex with the prompt piped on stdin:

```
codex exec < "$RUN_DIR/peer-prompt.md" > "$RUN_DIR/peer.out"
```

`peer.out` is codex's full transcript; extract the fenced JSON block tagged `review-peer-review` from it to get the verdicts array. Write that verdicts array to `$RUN_DIR/peer.json`, append `{stage: peer-review, status: done, provider: codex}`, then apply the verdicts as described below.

If codex returns non-zero, do not abort: record `{stage: peer-review, provider: codex, status: fallback, error: "<first line of stderr>"}` and fall through to the Claude path. (Never log `status: error` for a recoverable codex failure: `magpie status` stops at the first `error` entry and would report the run as poisoned even after the Claude fallback succeeds.)

**Claude path (fallback).** When `codex` is unavailable or failed, get the second opinion from a Claude subagent instead. Set `<<PEER_PROVIDER>>` to `claude`, then prepend the `magpie-peer-review-claude-preamble` block from `references/peer-review.md` to the substituted peer-review prompt (the preamble forces genuine independence, since the reviewer shares a model family with the primary reviewers). Dispatch one subagent (Agent tool, `general-purpose`) whose entire task is that combined prompt, and instruct it to return only the fenced `review-peer-review` JSON block. Write its output to `$RUN_DIR/peer.out`, extract the `review-peer-review` block to `$RUN_DIR/peer.json`, and append `{stage: peer-review, status: done, provider: claude}`.

**Apply the verdicts (both paths).** Parse the verdicts JSON and apply the `update` / `add` entries (an empty array means no change). For each `add`, mint a unique `id` on the new finding before merging (`peer-1`, `peer-2`, ...): the peer contract does not include ids, but every finding in `findings.final.json` must carry one or the report render and post stages will crash. Then write `findings.final.json`. Re-render progress.

### 8. Report

```
magpie render "$RUN_DIR" findings
```

Append `{stage: report, status: done}` to `$RUN_DIR/log.jsonl` and re-render progress (the render CLI does not log this itself, and `magpie status` needs the `done` entry to resume past `report`).

Print to the terminal: "Findings ready at <url>. Tick the ones you want and click **Post Selected**, or reply `post` here and I'll post whatever you've ticked."

End the turn.

### 9. Post

Most users will tick the checkboxes in the served report and click **Post Selected** (or **Post Recommended**, which takes every finding whose `risk.action` is `must-fix` or `should-fix`, skipping the `consider`/`optional` ones); the report server handles the rest and posts the batch as one GitHub review with inline threads. The agent only handles posts when the user explicitly types `post` (optionally `post 1,3,7` for indices) in the conversation, which takes the CLI path below: separate inline comments plus a top-level summary comment. Either path records posted ids in `post-status.json`, so the two cannot double-post the same finding.

When the user types `post`, read `$RUN_DIR/state/events`. Fold the events in order, keeping the LAST event per finding id; ids whose last event is `select` are selected. (Not union-minus: the UI emits one event per toggle, so select then deselect then select again must resolve to selected.) Merge with any explicit indices the user named (1-based, against `findings.final.json` in file order). If that leaves nothing selected, say so and ask rather than posting an empty batch. Then post via the CLI:

```
magpie post "$RUN_DIR" --ids id1,id2,id3
```

That delegates to `runPost`, which:

- Picks `formatInlineBody` (severity heading, `<sub>` risk metaline, parsed `Observation`/`Why it matters`/`Suggested direction`/`Needs verification` sections, optional `` ```suggestion `` block, hidden `magpie:finding` marker) when the finding has a `line`, and uses `gh api repos/<owner>/<repo>/pulls/<n>/comments` to open an inline review thread.
- Falls back to `formatConversationBody` (same shape plus a `Location · <file>:<line>` metaline) posted via `gh pr comment <n>` when there is no anchor, or when GitHub rejects the inline anchor with 422.
- When at least one new finding is being posted in this batch (default `auto` mode), prepends one top-level summary comment (verdict line, "Needs Attention" top three, `<details>` risk breakdown) and persists the sentinel `__summary__` in `post-status.json` so re-runs don't duplicate it. Override with `--include-summary always|never` if you need to force or suppress it.
- Appends `{stage: post, ...}` events to `log.jsonl` and updates `$RUN_DIR/post-status.json` per finding id.

Pass `--dry-run` to record the would-be gh commands without invoking gh. After posting, append `{stage: post, status: done}` to `$RUN_DIR/log.jsonl` (`runPost` logs per-finding `ok`/`failed` events but not the stage-complete marker, and `magpie status` counts only `done`), then re-render the report so the badges update:

```
magpie render "$RUN_DIR" findings
```

### 10. Cleanup

```
magpie cleanup "$RUN_DIR" --repo "$REPO"
```

If the context stage bound code intelligence, rebind the session to the repository now: call `bind_workspace` with `$REPO`. Binding is per session with no per-call override, so a run that ends without this leaves your session pointed at a worktree `cleanup` just deleted. The daemon prunes the seeded index on its own once the worktree is gone.

The run directory is renamed to `<run-dir>.archived-<timestamp>` and the worktree is removed. The CLI prints two lines on success: `archived to <path>` and `view later: magpie open <archived-id>`. Surface that second line to the user verbatim so they have a one-command path back to the report.

The archived `findings.html` is self-contained and auto-switches to read-only "archived" mode when opened, so:

- `magpie open` (no args) opens the latest run in the user's default browser via `open`/`xdg-open`. Add `--dry-run` to see the command without spawning.
- `magpie open <id>` opens a specific archived run.
- `magpie serve <id>` re-spins the Bun server against an archived run if the user wants the live interactive surface back (posts still work because `pr.json` retains the head SHA).
- `magpie --list-runs` enumerates all runs in `~/.magpie/`.

## Resuming a crashed run

A run is resumable while `$RUN_DIR/log.jsonl` exists and the run has not been archived. Do not test for `state/server-info`: the server deletes it whenever it stops, so a perfectly resumable run fails that check. Step 0 finds the run directory via `magpie --list-runs` when you don't already have it in `$RUN_DIR`.

```
magpie status "$RUN_DIR"
```

The JSON output tells you `lastCompleted` and `next`. Resume from `next`:

- `context` re-runs as written. The seeded index survives a crash, so the rebind is near-instant, and the scout re-runs only if `$RUN_DIR/brief.json` is missing.
- Any other stage: run it as written in the walkthrough.
- If a specialist focus has no findings file but its sibling stages are done, re-dispatch only that focus.
- Non-null `error` means the run stopped on a failed stage. Report which stage to the user and confirm before re-running it.

The server from the original run is gone. Restart it with `magpie serve "$RUN_DIR"` (step 2) before re-rendering, so the user gets a live URL again.

## Aborting

If the user types `abort` mid-run, run `magpie cleanup` immediately and exit.
