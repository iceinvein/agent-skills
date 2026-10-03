# Quality eval

Measures how well magpie picks findings, using what reviewers actually did with past runs
as labels: a final finding is `posted`, `dismissed` (with a reason) or `ignored`. The
other evals in `evals/` check that the skill follows its walkthrough; this one checks
whether the findings it keeps are the ones a reviewer wanted.

Run every command from `skills/magpie`.

## The corpus

```
bun evals/quality/corpus.ts
```

Copies every run under `~/.magpie` (or `$MAGPIE_HOME`; active and `.archived-` alike,
`preview-*` skipped)
that has both `post-status.json` and `findings.final.json` into
`~/.magpie/corpus/<runId>/`: `pr.json`, `diff.patch`, `findings.deduped.json`,
`findings.kept.json`, `findings.final.json`, `merge-candidates.json` and `brief.json`,
each when present. It then writes `labels.json` by folding `post-status.json`,
`state/events` and `log.jsonl`, and prints one line of counts per run. Rebuilding replaces
each run's corpus directory.

The corpus holds client code, so it never lives in the repo: the script exits 1 when the
corpus dir resolves inside the git repository that holds it. `--out <dir>` points it
elsewhere, for tests and dry runs; every script below takes the same flag.

Older runs predate merge candidates, briefs and the dismiss UI. A missing optional file is
read as absent; a file that is present but does not parse fails the build, naming it.

## Metrics

`score.ts` exports `scoreSelection`, which scores a set of kept ids against the labels:

- `kept`: findings in the selection.
- `posted`: posted labels on findings in the candidate pool the selection was made from
  (`findings.deduped.json` for the critic). Peer-review additions reach
  `findings.final.json` without passing the critic, so they are not held against it.
- `postedKept`: kept findings that were posted.
- `precision`: `postedKept` over kept findings that have a label. Every id in
  `findings.final.json` has one; a kept id that peer review removed before the report is
  labelled `ignored`, since the reviewer never saw it. A kept id with no label at all (a
  replay keeping a candidate the original critic dropped) is left out of the denominator.
  Null when nothing labelled was kept.
- `recall`: `postedKept` over `posted`. Null when nothing was posted.
- `dismissedKept`: kept findings dismissed, by reason (`wrong`, `not-worth-it`,
  `duplicate`, `style`).
- `byDomain`: `kept` and `postedKept` per specialist domain (`unassigned` when a finding
  has none).
- `byVia`: posted kept findings by post route (`recommended`, `selected`, `one`, `cli`;
  `unrecorded` for runs that logged no route).

`matchFindings` pairs a replay's freshly generated findings with labelled ones: same file,
line within 5, title Dice of at least 0.4 on `tokenize(title)`. Pairs are taken best Dice
first, each labelled finding matched at most once.

## Confounds

Read every number here with these in mind.

- **Post Recommended.** The report's "Post recommended" button posts the top findings in
  one click. A finding posted that way was not individually judged, so `posted` partly
  measures rank, not worth. `byVia` separates those posts out where the run logged a
  route.
- **Ignored is not rejected.** Most runs predate the dismiss UI, so a finding the reviewer
  disliked usually reads as `ignored`, not `dismissed`. Precision treats `ignored` as a
  miss, which is harsh on any finding the reviewer simply did not get to.
- **Repeated PRs.** Several runs review the same PR at different heads (three runs of
  PR 50 today). Their findings overlap heavily, and a reviewer who posted a finding on one
  run tends not to post it again on the next, which drags the later run's precision down.
  Pooled totals weight those PRs once per run.
- **Baseline recall is 1 by construction.** The reviewer only ever saw kept findings, so
  every posted finding in the pool was kept. Recall only means something for a replay,
  where a different critic can drop a finding the reviewer posted.

## Baseline

```
bun evals/quality/baseline.ts
```

Scores each run's original `findings.kept.json` against its labels, prints a table with a
pooled `TOTAL` row, and writes `~/.magpie/corpus/results/<ts>-baseline.json`. No model
calls; free to run.

## Critic replay

```
bun evals/quality/replay-critic.ts --corpus <runId> --repo <path-to-local-clone>
```

Re-runs stage 6 alone on one corpus run:

1. `git -C <repo> worktree add --detach <scratch>/worktree <headRefOid>`. The PR head must
   already be in the clone (`git fetch origin pull/<n>/head`); a missing sha exits 1.
2. Copies the corpus files into a scratch run dir under the system temp dir.
3. `magpie critic-prompt`, then one `claude -p --allowedTools Read,Grep,Glob,Write
   --output-format json --add-dir <scratch>` per batch, prompt on stdin, from the
   worktree. Batches run in parallel. A non-zero exit, an `is_error` result or a missing
   output file fails the replay.
4. `magpie critic-apply`, then `scoreSelection` over the new `findings.kept.json`, written
   with the run's baseline score to `results/<ts>-critic-<runId>.json`.
5. Removes the worktree and scratch dir whatever happened.

**Cost:** one Claude session per batch of up to 30 candidates; the corpus runs have 17 to
84 deduped candidates, so 1 to 3 sessions each. Each session reads the candidates' code in
the worktree, so cost grows with candidate count. The results file records the
`total_cost_usd` Claude reports, summed over batches. There is no spend cap on this tier.

## Full replay

```
bun evals/quality/replay-full.ts --corpus <runId> --repo <path-to-local-clone> [--max-cost-usd N]
```

Re-runs stages 3 to 6 (context, specialists, dedupe, critic) on the run's `diff.patch`:

1. Scaffolds a scratch run dir: worktree at the PR head as above, `pr.json` and
   `diff.patch` copied, the deterministic tests finding and a `setup` done line written in
   place of `magpie setup` (which needs the live PR), then `magpie shard`.
2. Runs one `claude -p --allowedTools Bash,Read,Grep,Glob,Write,Edit,Agent
   --max-budget-usd <N> --output-format json` from the worktree, telling it to follow this
   checkout's `SKILL.md`, resume from `magpie status`, and stop once `findings.kept.json`
   is written. Serve, peer review, report, post and cleanup are skipped.
3. Matches the new kept findings to `findings.final.json` with `matchFindings` and scores
   them; unmatched findings count as `unlabelled` and stay out of precision. Writes
   `results/<ts>-full-<runId>.json`.

**Cost:** a whole review: a scout, five specialists per shard, and the critic batches.
`--max-cost-usd` (default 10) is passed to Claude as `--max-budget-usd`, the CLI's own
spend cap; `claude -p` has no `--max-cost-usd` flag. Hitting the cap stops the session,
and the replay then fails without scoring, on Claude's error result or on the missing
`findings.kept.json`.
