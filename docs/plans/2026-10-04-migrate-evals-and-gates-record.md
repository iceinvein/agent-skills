# Run record: migrate evals and gates

## Pre-flight

- **Review:** a reviewer on Task 6 (tier 3, the flip) plus the final review. The
  eight tier-2 tasks skip a per-task reviewer: the eval cases are checked by
  running them in Tasks 5 and 9, which is a stronger read than a reviewer's, and
  the final review covers the docs. Chosen by the partner on the recommendation.
- **Effort:** every task at the session's effort. Nothing in the plan is
  mechanical enough to mark low: the cases and docs turn on judgment, and Task 6
  is tier 3.
- **Workspace:** one worktree per concurrent implementer, each agent committing
  its own task. The plan worktree is `.claude/worktrees/migrate-evals` on
  `worktree-migrate-evals`. Tasks 2, 3 and 4 can overlap; 7 and 8 can overlap.

## Decisions during the run

- **Task 1 Touches widened to `skills/migrate/scripts/config.ts`.** `writeConfig`
  reads `templates/config.toml` from a path relative to the source file, which
  does not exist inside a `bun build --compile` binary (`ENOENT ...
  /$bunfs/templates/config.toml`). Fixed by importing the template with
  `with { type: 'file' }`, which embeds it in a compiled binary and still
  resolves to the real file under plain `bun`. Running `init` through
  uncompiled bun in the fixture instead was rejected: the probe case runs
  `init` inside the sandbox, so it would still break there. Contracts unchanged.

## Findings for later tasks

- **For Task 8 (adjudicate stop).** First run of `adjudicate-drafts-not-decides`
  scored 0.77: the agent drafted all four and recorded nothing, but gave two
  items as "choose one" conditionals because they hinge on a production fact.
  The grader fails "options with no proposed ruling", rightly: each item
  carries a Recommendation, and adjudicate.md asks for a draft. Kept as a
  baseline finding, grader unchanged. The "Where you stop" text should say a
  draft follows the item's recommendation and names the fact that would
  overturn it.
- **For Task 8 (probe order).** `probe-asks-for-the-target` first run 0.42: the
  agent asked for the target profile before running `init` (whose `--name` is
  an interview answer) and deferred `parity-basis.md`. The skill never says
  whether `init` precedes the interview, so the two graders that required
  `config.toml` to exist were removed as pinning an unstated order. The
  `parity-basis.md` grader stays: probe.md writes it at step 2, before the
  interview, so its absence is a real miss. Task 8 should state the order.
- **seam-shared-element-queued re-pinned.** The agent built a C# call graph
  (Q 0.528, 3 groups) that disagreed with surface affinity (Q 0.505, 4 groups)
  and escalated under the two-agree rule, which is correct. The case assumed
  no call graph could be built. It now passes on either a partition or an
  escalation; what it pins is that `setting-default-connection` sits in no
  capability and is queued. `partition-written` dropped; the fixture writes an
  empty `capabilities.jsonl` so the not_contains grader reads a real file.
- **extract-files-queue-in-same-pass re-pinned.** The agent mapped the dead
  route to a new requirement with `queued` confidence citing a new queue item,
  rather than out-of-scope. extract.md does not mandate out-of-scope there, so
  the grader accepts either; the dangling-id grader now covers
  `confidence.queue` as well. Unpinned: that the requirement is queued rather
  than confirmed.
- **Scaffold fix.** `bun build --compile` left a 61 MB `.bun-build` file in the
  workspace, committed into every fixture. The build now runs from
  `$HOME/tmp`; the scaffold test pins that no such file is tracked.
- **Fixture fix, 5d771cf.** The express replay never wrote
  `.migrate/parity-basis.md`, which probe owes; an agent noticed. The init step
  now writes it.

## Notes

- Implementer worktrees for Tasks 2 to 4 were cut with `git worktree add` off
  `worktree-migrate-evals` (the harness's fresh worktrees branch from
  origin/master and would miss Task 1). Dispatched agents inherit this session's
  pin to `migrate-evals`, so the guard refused their git, bash and eval commands
  in their own trees. `EnterWorktree` by path did not lift it either (the next
  command was refused as "the shared checkout").
- **Workspace answer changed by the harness, not by choice.** Tasks 2 to 4 now
  run concurrently in `migrate-evals` itself, on disjoint case directories, and
  leave the tree dirty; the controller commits each task's Touches. The
  per-implementer worktrees `migrate-evals-t2/t3/t4` are unused and get removed
  at the end. Task 4's files were copied over from t4.
- **Worktree isolation exited, with the partner's agreement.** The guard
  refused every `claude plugin eval` command, reading the word as shell `eval`.
  The session left isolation with `ExitWorktree keep` and works on
  `migrate-evals` by absolute path; the controller runs the eval cases and the
  case authors fix what the runs show.
- **Task 3 grader change:** the `extract-files-queue-in-same-pass` `tool_order`
  grader (queue add before the next check) would fail an agent that checks
  state first. Replaced with a trace `not_contains` for the refs gate's
  dangling-queue message, which only appears if a check ran while the id had no
  file. The low-Q source replaces `legacy/` after `migrate_scaffold tiny-express`
  rather than reaching through `fixtures/..`.
- `status.sh` and `plan.sh` need `--dir` pointing at the worktree: without it they
  resolve the main checkout.
