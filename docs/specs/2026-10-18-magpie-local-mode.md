# Design: magpie local mode

(Sluice deep channel. Design signed off 2026-10-18; the task plan is
`docs/plans/2026-10-18-magpie-local-mode.md`.)

## Context

Magpie only reviews GitHub PRs today. Setup takes `--pr`, fetches `pr.json` and the
diff via `gh`, cuts a detached worktree at the PR head, and the run ends with an HTML
report and posting via `gh`. An implementing agent (or the orchestrator of a sluice
run) wants the same review on its own branch before any PR exists: in session, on the
tree it is editing, with the findings coming back to it to address rather than to a
human in a browser.

Decided already (2026-10-18):

- **Diff:** merge-base to working tree, uncommitted and untracked edits included.
- **Code under review:** the caller's live tree. No separate worktree.
- **Stages:** the full pipeline (scout, checks, specialists, dedupe, critic, peer
  review) minus serve, report and post. The result is `findings.final.json` plus a
  terminal handoff.
- **Base:** `--base <ref>` when given, else `origin/HEAD`; fail loudly if neither
  resolves.

## 1. Setup: `magpie setup <run-dir> --local [--base <ref>] [--intent-file <path>] [--repo <path>]`

`--local` and `--pr` are mutually exclusive; passing both or neither is a usage error
(exit 2). The local path in `runSetup` replaces the `fetch-pr`, `incremental` and
`worktree` steps; preflight, path filter, shard and tests-check run unchanged.

New `scripts/local-diff.ts` exports `localBranchDiff({gitBin, repoPath, baseRef})`:

1. Resolve the base: `baseRef` if given, else `origin/HEAD`. Unresolvable is an error
   naming what was tried. No fetch: the caller's local view of the base is what the
   branch was built against, and a silent network call mid-session is a surprise.
2. `git merge-base <base> HEAD`.
3. `git diff --no-color --find-renames <mergeBase>` (working tree, tracked files).
4. Untracked files from `git ls-files --others --exclude-standard`, each appended as
   `git diff --no-index /dev/null <file>`. The index is never touched (`git add -N`
   would mutate the caller's staging area).
5. An empty combined diff is an error ("nothing to review against <base>"), not an
   empty run.

Setup writes `diff.patch`, `diff-source.json` (`source: "local"`, `mergeBase`), and
two new files:

- `target.json`: `{mode: "local", root: <absolute repoPath>}`. PR runs write
  `{mode: "pr", root: <run-dir>/worktree}`. A run with no `target.json` (predates this
  change) is read as PR mode with the worktree root, so archives keep working.
- `local.json`: the metadata `pr.json` carries for a PR, sourced from git:
  `{branch, baseRef, mergeBase, head, dirty, author, commits: [{oid, headline, body}],
  intentFile}`. `branch` is `null` on a detached HEAD. `author` is `git config
  user.name`, an error if unset. `intentFile` is the absolute path from
  `--intent-file` (a spec or plan the implementer is working to), checked to exist, or
  `null`.

No `pr.json` is written in local mode: a file named for a PR that holds no PR would
mislead every reader, and the readers that need it (render, server, post, incremental)
are exactly the stages local mode skips.

## 2. Review root: one place that says where the code is

New `reviewRoot(runDir)` (in `scripts/target.ts`) reads `target.json` with the
fallback above. `dedupe-cmd.ts` (evidence check) and `critic-cmd.ts` (`<<WORKTREE>>`)
call it instead of `join(runDir, 'worktree')`. That is two callers, one short of the
house rule for an abstraction; it earns its place because the fallback for old runs
must not drift between them.

`magpie target <run-dir>` prints the root so SKILL.md can set `$WORKTREE` from it.

Cleanup is safe by construction: it removes only `<run-dir>/worktree`, which local
mode never creates, so the caller's tree is never a candidate for
`git worktree remove --force`. A test pins that a local run's cleanup leaves the repo
path intact.

## 3. Prompts

- `scout.md`, `checks.md`, `specialists.md`: `Working directory: <RUN_DIR>/worktree`
  becomes `Working directory: <WORKTREE>` (same substitution step as `<RUN_DIR>`).
  "PR #<PR_NUMBER>" becomes a `<TARGET>` placeholder: `PR #123` or
  `local branch feat/x against main`. The rest of the wording ("this PR") stays; a
  reviewer reads a branch diff the same way.
- `scout.md` gains one local paragraph: intent evidence is `local.json` (commit
  headlines and bodies, and the `intentFile` when set) instead of `pr.json`.
- `peer-review.md`: a local substitution list (`<<PR_TITLE>>` = `Local branch
  <branch>`, author from `local.json`, head = branch, base = `baseRef`).

## 4. Handoff: `magpie handoff <run-dir>`

Prints the result for the calling agent as markdown on stdout and logs
`{stage: handoff, status: done}`:

- Header: target, counts by severity, the run dir, and a staleness line when the
  tree has moved since setup (recomputes the local diff and compares its sha256 with
  one setup recorded in `diff-source.json`). Moved means some anchors may be off; it
  is a warning, not an error.
- Findings ordered as the report orders them (recommended first, then score), each:
  `N. [severity] file:line: title`, then the parsed Observation / Why it matters /
  Suggested direction / Needs verification sections (`finding-description.ts`), and
  the `suggestion` code block when present.
- Footer: an instruction to the caller: address each `must-fix` and `should-fix`, or
  say why not; the rest are optional.

Errors if the run is not local (`target.json` mode `pr`) or `findings.final.json` is
missing.

## 5. Status ladder

`runStatus` reads the mode. Local runs use
`[setup, context, specialists, dedupe, critic, peer-review, handoff]`; PR runs keep
the current ladder. A local run past `handoff` reports `next: cleanup`.

## 6. SKILL.md

- Description gains the local trigger: self-review of the current branch diff before a
  PR, typically from an implementing or orchestrating agent.
- Step 0 branches: no PR in the request and a local ask means local mode. Run id
  `local-<branch-slug>-<ts>` (`detached` when no branch); resume matches
  `local-<branch-slug>-*`.
- A "Local mode" section lists the deltas, not a second walkthrough: setup flags; set
  `WORKTREE=$(magpie target "$RUN_DIR")`; skip stage 2 and every `magpie render`; stages
  3 to 7 unchanged; stage 8 becomes `magpie handoff`, whose stdout is the reply to the
  caller; then `magpie cleanup` immediately (no labels worth keeping, no server to
  stop); end the turn.
- Two rules stated plainly: do not edit the tree while the run is in flight (anchors
  and evidence are read from it live); and the pipeline needs the Agent tool, so a
  session that cannot dispatch subagents stops with that reason rather than reviewing
  single-handed.

## 7. Evals

One new case, `local-mode-hands-back`: a local run scaffolded at stage 8 with
`findings.final.json`. Pins: calls `magpie handoff`, never `serve`/`render`/`post`/`gh`,
runs cleanup, ends the turn with the findings list.

## Out of scope

- Re-running the review automatically after the caller's fixes (the caller can run
  local mode again).
- Wiring local mode into sluice's review step. That is a sluice change and goes
  through its own run.
- Posting local findings anywhere, or a read-only HTML view of them.
- Labels: cleanup still writes `labels.json` (all `ignored`); the eval corpus only
  takes runs that posted, so local runs never enter it.
