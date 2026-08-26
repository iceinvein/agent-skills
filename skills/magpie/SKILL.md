---
name: magpie
description: Use when the user asks to review a GitHub pull request (a PR number, PR URL, or "review this PR"). Interactive PR review pipeline; five parallel specialist subagents, dedupe, critic, codex/Claude peer review, and an interactive HTML report for posting selected findings via gh. Follow the stage walkthrough in this skill; the description is not the procedure.
---

# Magpie

## Prerequisites

The skill pre-flights `bun`, `gh`, `git` (required) and `codex` (optional). A missing required binary aborts the run with a single install hint line. Code intelligence is not pre-flighted: stage 3 probes for it, over either the `code-intel` CLI or the code-intelligence MCP server, and the run continues without it. Without `codex` the run continues and peer review falls back to a Claude second-opinion subagent (setup prints a one-line notice and logs `{stage: preflight, status: done, missingOptional: ["codex"]}`).

## Stage walkthrough

Stop reading and follow these steps in order. Do not skip stages. Use the exact Bash invocations below.

### 0. Identify the PR

Parse the user's request for a PR number, URL, or "this PR" (current branch). If ambiguous, ask one clarifying terminal question. Capture the PR number into `$PR_NUMBER` and the repo path into `$REPO` (default: the current working directory).

Before minting a new id, check whether an earlier run on this PR is unfinished:

```
magpie --list-runs
```

Each line is `<id>\t<active|archived>\t<path>`. If an `active` id matches `pr-${PR_NUMBER}-*`, that run was interrupted rather than cleaned up. Set `RUN_DIR` to its path and go to "Resuming a crashed run"; ask the user first if it is unclear whether they want to resume or start over. (`archived` ids are finished runs, not resumable.)

Otherwise compute a fresh run directory:

```
RUN_ID="pr-${PR_NUMBER}-$(date +%s)"
RUN_DIR="$HOME/.magpie/$RUN_ID"
```

### 1. Setup

```
magpie setup "$RUN_DIR" --pr $PR_NUMBER --repo "$REPO"
```

If exit is non-zero, surface stderr verbatim and stop. The CLI removes the worktree and subdirs on failure, keeping the run directory and `log.jsonl` for diagnostics.

Setup filters lockfiles, build output, generated source, and snapshot fixtures from `diff.patch` before specialists see it. Users override with `.magpie.json` at the repo root: `{"exclude": [...glob], "include": [...glob], "useDefaults": true|false}`. When anything is filtered, the raw diff is kept as `$RUN_DIR/diff.full.patch` and the exclusion list as `$RUN_DIR/excluded-files.json`.

When `gh pr diff` refuses the diff (HTTP 406 above roughly 300 files) or returns an
empty diff for a PR with changed files, setup rebuilds it from the local clone instead
of aborting: it fetches `pull/<n>/head` and diffs from the merge base against the PR's
base branch, reproducing the three-dot semantics `gh pr diff` uses. A local head that
does not match the PR's `headRefOid` is a hard error, not a silently stale review. The
`fetch-pr` log entry records `source: "gh" | "git"` and the merge base, and
`$RUN_DIR/diff-source.json` carries the same for the report.

Setup then splits the filtered diff into shards, writing `$RUN_DIR/shards/manifest.json`
and, when more than one shard results, `$RUN_DIR/shards/shard-<n>.patch`. `diff.patch`
itself is never modified: shards are views over it. Re-split with a different budget
using `magpie shard "$RUN_DIR" --budget <lines> --max-files <n>` (defaults: 6000 patch
lines, 80 files). Re-splitting invalidates every existing
`findings/<focus>.shard-<n>.json`, since a shard id then names a different file set:
delete those files first, or stage 4's resume rule counts a pair as covered that
nothing reviewed.

When a prior run exists for the same PR (active or archived under `~/.magpie/`), setup writes `$RUN_DIR/incremental.json` with `{previousRunId, previousSha, currentSha, sameSha}`. The post stage surfaces this as a "Incremental review since `<sha>`" trailer on the summary comment.

Setup also runs a deterministic test-coverage check: when the diff contains zero test or spec files anywhere, each non-test source file with `>= 10` added code lines gets a `domain: "tests"` finding in `$RUN_DIR/findings/tests.json`. That sixth domain flows through dedupe/critic/peer-review alongside the five LLM specialists; no subagent is dispatched for it.

### 2. Serve

Start the HTML server in the background using the Bash tool with `run_in_background: true`:

```
magpie serve "$RUN_DIR"
```

Read `$RUN_DIR/state/server-info` for the URL; the server writes it asynchronously, so if it is missing, wait a moment and re-read (it appears within ~1s). Print to the user: "Open <url> in your browser to follow along."

The server shuts down after 30 idle minutes (an open report tab heartbeats every 30s, so it stays up while the user is looking) and deletes `state/server-info` on the way out. Nothing in the pipeline depends on it: re-run `magpie serve "$RUN_DIR"` to bring the report back.

Render the first progress paint:

```
magpie render "$RUN_DIR" progress
```

### 3. Context

Append `{stage: context, status: running}` to `$RUN_DIR/log.jsonl` and re-render progress. This stage has two steps and never aborts the run.

**Probe.** Code intelligence reaches the same on-device daemon through two interfaces. Prefer the `code-intel` CLI: it takes `--repo` on every call, so it holds no session binding to leak past cleanup and the specialists can query in parallel without clobbering each other's workspace. `$RUN_DIR/worktree` is a linked git worktree either way, so an already-indexed base repo seeds its index instead of re-indexing.

- **CLI**, when `command -v code-intel` succeeds. Run `code-intel index status --repo "$RUN_DIR/worktree" --json` and read `.status`: `ok` sets `CODE_INTELLIGENCE=cli`. `indexing_started` or `indexing_in_progress` means the seed took, so poll the same command every 5s for at most 60s and set `CODE_INTELLIGENCE=cli` either way. Exit 3 is a stopped daemon: run `code-intel start`, re-probe once. **Never run `code-intel index approve`.**
- **MCP**, when the CLI is absent but `mcp__code-intelligence__*` tools are in your tool list. Call `bind_workspace` with `$RUN_DIR/worktree` and apply the same rules, polling `get_index_stats` instead, to set `CODE_INTELLIGENCE=mcp`. **Never call `approve_indexing`.**
- `consent_required` on either interface means the base repo has never completed an index, and starting one is a full GPU pass the user did not ask for. That, no interface at all, or any other error that survives one retry, sets `CODE_INTELLIGENCE=unavailable`; print one line: "Code intelligence is unavailable (<reason>); specialists will review from the diff alone."

Never block the pipeline on a still-running index. The scout and specialist contracts both handle a tool that is not ready yet.

**Scout.** Read `references/scout.md` and dispatch one subagent (Agent tool, `general-purpose`) carrying the `magpie-scout` block with `<<RUN_DIR>>`, `<<PR_NUMBER>>`, and `<<CODE_INTELLIGENCE>>` substituted. It writes `$RUN_DIR/brief.json`.

Append `{stage: context, status: done, codeIntelligence: true|false, interface: "cli"|"mcp"|"none"}` and re-render progress. If the scout returned without writing `brief.json`, append `{stage: context, status: skipped, codeIntelligence: true|false, interface: ...}` instead and continue: the brief is optional everywhere it is read. Both entries carry the probe's result, which is known whatever the scout did, and `interface` is what stage 10 reads to decide whether there is a session to rebind.

### 4. Specialists

Read `references/specialists.md` now, before dispatching anything: it holds the five focus blocks and the output contract every specialist prompt is built from. Assemble prompts from that file verbatim; written from memory they drift off the JSON contract, and `magpie dedupe` drops findings it cannot parse.

Append `{stage: specialists, status: running}` to `$RUN_DIR/log.jsonl` and re-render
progress, so the served page shows the stage as active rather than "Paused". Then read
`$RUN_DIR/shards/manifest.json`.

**One shard, zero shards, or no manifest** (a diff filtered down to nothing, e.g. a
lockfile-only PR, yields `shards: []` in an otherwise normal manifest; a run predating
this feature has no manifest at all): dispatch the five specialists in a single message,
five parallel Agent calls, one per focus in (security, bugs, performance, code-smells,
architecture), each carrying the prompt `references/specialists.md` describes with the
unsharded run header. The shard gate and the wave dispatch below do not apply; the
logging and the file check at the end of this stage still do.

**More than one shard:** each focus reviews every shard, so the run dispatches
`5 × <shard count>` subagents in total.

**More than four shards: stop and ask the user once, before dispatching anything.**
State the shard count, the resulting agent count, and the three options: proceed as
sharded; re-shard for fewer, larger chunks with
`magpie shard "$RUN_DIR" --budget <lines> --max-files <n>`, raising both flags (a PR of
many small files is split by the 80-file cap, so a larger `--budget` alone changes
nothing); or review only the highest-risk shards, which means appending
`{stage: shard-coverage, status: partial, reviewed: [<ids>], skipped: [<ids>]}` to
`$RUN_DIR/log.jsonl` and telling the user in the terminal which shards go unreviewed.
That log entry is the only record of the gap: the report has no unreviewed marker.
Wait for the answer. This is the only interactive gate in the pipeline before the
report, and it exists so that neither the cost nor a coverage gap is ever silent.

Dispatch by wave, one shard per wave, the five focuses in parallel within a wave,
re-rendering progress between waves. That holds in-flight agents at five and makes a
crash cheap to resume: only the `(focus, shard)` pairs whose findings file is missing
need re-dispatching.

After each subagent returns, append
`{stage: specialist, focus: <focus>, shard: <n>, status: done, findings: <count>}` to
`$RUN_DIR/log.jsonl` and re-render progress. Omit `shard` on the unsharded path (one
shard, zero shards, or no manifest).
(Per-focus `specialist` entries are diagnostic; only the aggregate `specialists` entry
advances `magpie status`.)

Before leaving this stage, list `$RUN_DIR/findings` and confirm one file per expected
`(focus, shard)` pair: `5 × <shard count>` named `findings/<focus>.shard-<n>.json` when
sharded, five `findings/<focus>.json` otherwise, plus `findings/tests.json` from setup.
Re-dispatch any pair missing from a shard you meant to review; a shard skipped at the
gate is expected to have none. `magpie dedupe` re-checks this against the manifest and
names every missing pair on stdout, as a backstop rather than a substitute.

If every specialist fails (no findings files written), log
`{stage: specialists, status: error}`, rebind code intelligence to `$REPO` if
`CODE_INTELLIGENCE=mcp` (stage 10), and stop. Otherwise mark `{stage: specialists, status: done}`.

### 5. Dedupe

```
magpie dedupe "$RUN_DIR" [--threshold <0-10>]
```

`magpie dedupe` also runs a deterministic evidence check against the worktree: findings whose `file` is missing or whose `line` is out of range are dropped, logged, and recorded to `$RUN_DIR/evidence-dropped.json`. The check is skipped when the worktree is gone (archived run replay).

Each finding gets a derived 0-10 `score` from its risk fields; those below `--threshold` (default 3) are dropped before the critic LLM runs and recorded to `$RUN_DIR/threshold-dropped.json`. Pass `--threshold 0` to keep everything.

Re-render progress.

### 6. Critic

Read `references/critic.md` and `$RUN_DIR/findings.deduped.json`. Substitute both placeholders in the critic rubric (the compact candidate list including each finding's `onChangedLine`, and the `<<DIFF_EXCERPT>>` hunks for the referenced files), then apply the rubric verbatim (one verdict per finding). Write the kept subset to `$RUN_DIR/findings.kept.json`. Append `{stage: critic, status: done}` and re-render progress.

When `findings.deduped.json` holds more than 40 findings, run the rubric in batches of
30 rather than one prompt: a sharded run can produce more candidates than fit alongside
their diff excerpts. Apply the same rubric verbatim per batch and concatenate the kept
subsets into `findings.kept.json`.

### 7. Peer review

Append `{stage: peer-review, status: running}` to `$RUN_DIR/log.jsonl` and re-render progress. This stage always runs. `codex` is preferred because it is a different model from the Claude agents that produced the findings; without it, a Claude second-opinion subagent stands in.

Build the peer-review prompt first: read `references/peer-review.md`, take the `magpie-peer-review` block from it, and substitute the placeholders listed in that file's `## Substitute before use` preamble.

One batch carries up to 40 findings; above that, split them 30 at a time, as in stage 6.
Write each batch's prompt, its `<<KEPT_FINDINGS_COMPACT>>` narrowed to that batch, to
`$RUN_DIR/peer-prompt-<k>.md`, `<k>` counting from 1. **When there is a single batch, drop `-<k>` throughout** (`peer-prompt.md`,
`peer.out`), which is the common case. Keep the `add` id counter running across batches
(`peer-1`, `peer-2`, ...): restarting it per batch produces colliding ids, and every
finding in `findings.final.json` must have a unique one or the report and post stages
crash.

**Codex path (preferred).** If `codex` is available (setup did not log `missingOptional: ["codex"]` and `command -v codex` succeeds), set `<<PEER_PROVIDER>>` to `codex` and run codex once per batch, that batch's prompt piped on stdin:

```
codex exec < "$RUN_DIR/peer-prompt-<k>.md" > "$RUN_DIR/peer-<k>.out"
```

Each `peer-<k>.out` is codex's full transcript; extract the fenced JSON block tagged `review-peer-review` from each. Write the concatenated verdict arrays to `$RUN_DIR/peer.json` once, after the last batch: writing `peer.json` per batch keeps only the last batch's verdicts and silently discards the rest. Then append `{stage: peer-review, status: done, provider: codex}` and apply the verdicts as described below.

If codex returns non-zero on a batch, do not abort: record `{stage: peer-review, provider: codex, status: fallback, batch: <k>, error: "<first line of stderr>"}` and take the Claude path for that batch. (Never log `status: error` for a recoverable codex failure: `magpie status` stops at the first `error` entry and would report the run as poisoned even after the Claude fallback succeeds.)

**Claude path (fallback).** When `codex` is unavailable or failed, get the second opinion from a Claude subagent instead, one per batch. Set `<<PEER_PROVIDER>>` to `claude`, then prepend the `magpie-peer-review-claude-preamble` block from `references/peer-review.md` to each batch's substituted prompt (the preamble forces genuine independence, since the reviewer shares a model family with the primary reviewers). Dispatch one subagent (Agent tool, `general-purpose`) per batch whose entire task is that combined prompt, and instruct it to return only the fenced `review-peer-review` JSON block. Write each output to `$RUN_DIR/peer-<k>.out`, extract each `review-peer-review` block, merge into `$RUN_DIR/peer.json` after the last batch as above, and append `{stage: peer-review, status: done, provider: claude}` (`provider: mixed` if codex handled some batches).

**Apply the verdicts (both paths).** Parse the merged verdicts and apply the `update` / `add` entries (an empty array means no change). Mint each `add`'s `id` as above before merging, since the peer contract does not carry ids. Then write `findings.final.json`. Re-render progress.

### 8. Report

```
magpie render "$RUN_DIR" findings
```

Append `{stage: report, status: done}` to `$RUN_DIR/log.jsonl` and re-render progress (the render CLI does not log this itself, and `magpie status` needs the `done` entry to resume past `report`).

Print to the terminal: "Findings ready at <url>. Tick the ones you want and click **Post Selected**, or reply `post` here and I'll post whatever you've ticked."

End the turn.

### 9. Post

Most users tick the checkboxes in the served report and click **Post Selected** (or **Post Recommended**, which takes every `must-fix`/`should-fix` finding and skips the `consider`/`optional` ones); the server posts that batch as one GitHub review with inline threads. The agent posts only when the user types `post` (optionally `post 1,3,7` for indices), which takes the CLI path below: separate inline comments plus a top-level summary comment. Either path records posted ids in `post-status.json`, so the two cannot double-post the same finding.

When the user types `post`, read `$RUN_DIR/state/events` and fold them in order, keeping the LAST event per finding id; ids whose last event is `select` are selected. (Not union-minus: the UI emits one event per toggle, so select, deselect, select again resolves to selected.) Merge any explicit indices the user named (1-based, against `findings.final.json` in file order). If nothing is selected, say so and ask rather than posting an empty batch. Then post via the CLI:

```
magpie post "$RUN_DIR" --ids id1,id2,id3
```

That delegates to `runPost`, which:

- For a finding with a `line`, picks `formatInlineBody` (severity heading, `<sub>` risk metaline, parsed `Observation`/`Why it matters`/`Suggested direction`/`Needs verification` sections, optional `` ```suggestion `` block, hidden `magpie:finding` marker) and opens an inline review thread via `gh api repos/<owner>/<repo>/pulls/<n>/comments`.
- Falls back to `formatConversationBody` (same shape plus a `Location · <file>:<line>` metaline) via `gh pr comment <n>` when there is no anchor, or GitHub rejects the inline anchor with 422.
- When at least one new finding is in the batch (default `auto` mode), prepends one top-level summary comment (verdict line, "Needs Attention" top three, `<details>` risk breakdown) and persists the `__summary__` sentinel in `post-status.json` so re-runs don't duplicate it. Override with `--include-summary always|never`.
- Appends `{stage: post, ...}` events to `log.jsonl` and updates `$RUN_DIR/post-status.json` per finding id.

Pass `--dry-run` to record the would-be gh commands without invoking gh. After posting, append `{stage: post, status: done}` to `$RUN_DIR/log.jsonl` (`runPost` logs per-finding `ok`/`failed` events but not the stage marker, and `magpie status` counts only `done`), then re-render the report so the badges update:

```
magpie render "$RUN_DIR" findings
```

### 10. Cleanup

```
magpie cleanup "$RUN_DIR" --repo "$REPO"
```

If the context stage set `CODE_INTELLIGENCE=mcp`, rebind the session now: call `bind_workspace` with `$REPO`. MCP binding is per session with no per-call override, so ending a run without this leaves the session pointed at a worktree `cleanup` just deleted. A `cli` run has nothing to rebind, because `--repo` names the workspace on every call. Either way the daemon prunes the seeded index once the worktree is gone.

The run directory is renamed to `<run-dir>.archived-<timestamp>` and the worktree is removed. The CLI prints two lines on success: `archived to <path>` and `view later: magpie open <archived-id>`. Surface that second line verbatim so the user has a one-command path back to the report.

The archived `findings.html` is self-contained and auto-switches to read-only "archived" mode when opened, so:

- `magpie open` (no args) opens the latest run in the default browser via `open`/`xdg-open`; `--dry-run` prints the command instead of spawning it.
- `magpie open <id>` opens a specific archived run.
- `magpie serve <id>` re-spins the Bun server against an archived run for the live interactive surface (posts still work: `pr.json` retains the head SHA).
- `magpie --list-runs` enumerates all runs in `~/.magpie/`.

## Resuming a crashed run

A run is resumable while `$RUN_DIR/log.jsonl` exists and the run has not been archived. Do not test for `state/server-info`: the server deletes it whenever it stops, so a perfectly resumable run fails that check. Step 0 finds the run directory via `magpie --list-runs` when you don't already have it in `$RUN_DIR`.

```
magpie status "$RUN_DIR"
```

The JSON output tells you `lastCompleted` and `next`. Resume from `next`:

- `context` re-runs by redoing the probe, then dispatching the scout only if `$RUN_DIR/brief.json` is missing. The seeded index survives a crash, so the rebind is near-instant.
- Any other stage: run it as written in the walkthrough.
- If a specialist focus has no findings file but its sibling stages are done,
  re-dispatch only that focus. On a sharded run the unit is the `(focus, shard)` pair:
  read `shards/manifest.json`, and re-dispatch only the pairs with no
  `findings/<focus>.shard-<n>.json`. Never re-shard mid-run without deleting those
  files first (stage 1): the check would otherwise trust ids that moved.
- Non-null `error` means the run stopped on a failed stage. Report which stage to the user and confirm before re-running it.

The original server is gone. Restart it with `magpie serve "$RUN_DIR"` (step 2) before re-rendering, so the user gets a live URL again.

## Aborting

If the user types `abort` mid-run, rebind code intelligence to `$REPO` if `CODE_INTELLIGENCE=mcp` (stage 10), then run `magpie cleanup` and exit.
