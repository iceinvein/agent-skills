# Design: eval freshness for sluice and bug-hunter

## Context

A skill's rules encode what the model could not do on its own when the rule was
written. Models move, and the rule goes stale in one of two directions: the
model stops obeying it (a regression), or the model starts doing it unasked (the
rule is dead weight). The sluice evals README shows both by hand: Opus 5.5 routed
before reading `CLAUDE.md`, and announcements landed in thinking summaries. Each
was found by reading prose results and written up as prose.

This run builds the mechanism that finds them instead. It is the first of two:
the verification gates (bug-hunter inside `main` and `deep`, a mechanical check
on `fast`) come next, and this harness is what will measure them.

Decided with you before this design:

- Verification enters sluice as a gate per channel, not a fifth channel (next run).
- Bug-hunter fires in `main` only when the agreed intent states a checkable claim (next run).
- Freshness runs locally, on your Claude plan, through `claude plugin eval`. No CI
  job and no token in repo secrets.

## Decisions

### D1. Each skill carries a rules manifest

`skills/<skill>/evals/rules.json`, committed, one entry per rule the skill states:

```json
{
  "rules": [
    {
      "id": "route-reads-repo-instructions-first",
      "states": "SKILL.md: Route first",
      "origin": "docs/specs/2026-09-23-sluice-opus-5-5.md",
      "cases": ["superpowers-conflict-stands-down"]
    },
    {
      "id": "root-cause-before-fix",
      "states": "references/root-cause.md",
      "origin": "docs/specs/2026-08-07-sluice-design.md",
      "cases": [],
      "unpinned": "no case reproduces a red test yet"
    }
  ],
  "sandboxSensitive": ["deep-run-fans-out"]
}
```

- `origin` points at the spec or plan that introduced the rule, which is checkable
  in git. It does not invent a failure the history does not record.
- A rule with no case says so in `unpinned`. Gaps stay visible; this run does not
  write new cases to fill them.
- `sandboxSensitive` names cases whose score depends on the macOS git shim, so a
  local miss there is reported as such rather than as a regression.
- JSON, not YAML: `case.yaml` is the eval CLI's schema and an unknown key in it is
  not ours to add, and JSON needs no parser dependency.

A `bun test` file checks every manifest against the tree: each listed case
directory exists, each case directory is named by at least one rule, ids are
unique, and every rule has cases or an `unpinned` reason. That check is free, and
it runs in the existing publish job.

### D2. Per-model baselines are committed files

`skills/<skill>/evals/baselines/<model>.json`, one per model id. Eval results stay
gitignored; a baseline is the reduced record of a run you accepted:

- per case: mean score for the `with` arm and the `without` arm, the run count,
  and the per-run scores;
- the run's `claudeVersion`, judge model, skill version (from `skill.json`) and date.

### D3. One script runs, reduces and compares

`scripts/eval-freshness.ts`, with `package.json` entry `eval:fresh`:

- `run <skill> --model <id> [--runs N] [-j N] [--case <glob>]` calls `claude plugin eval
  skills/<skill> --scaffold --allow-tools Bash Write Edit --ablation with-without
  --model <id> --judge-model <id> --json <file>`, so the model and judge are pinned
  the same way every time (the README's standing trap), then runs `diff` on the
  result. It inherits your logged-in credential, so it spends plan usage. `--runs`
  defaults to 3 for a release read, and `-j` defaults to 2 so a full sluice pass
  does not exhaust the plan's rate limit in one burst.
- `diff <result.json> [--against <model>]` is free: it reduces a result and compares
  it with the baseline for the same model, or for `--against` when the model is
  new. That is the model-release read.
- `accept <result.json>` writes the reduced result as that model's baseline. It is
  never automatic; accepting a baseline is a judgement about the run.

### D4. What the comparison reports

Per case, then rolled up per rule through the manifest:

| Verdict | Condition |
|---|---|
| `regressed` | `with` mean drops below the baseline `with` mean by more than one run's worth (1 / runs) |
| `redundant` | the `without` mean is at least the `with` mean, and the `with` mean is 1.0: the bare model does what the skill asks |
| `flaky` | runs within one arm disagree on pass |
| `sandbox` | the case is in `sandboxSensitive` and missed |
| `steady` | none of the above |

A rule is an **expiry candidate** when every case pinning it is `redundant`, and
**at risk** when any of them `regressed`. The report says which; it never edits
`SKILL.md`. Pruning stays a decision you make with the report in hand.

Exit code: non-zero on any `regressed`, so the script can gate later if you want
it to. `redundant` and `flaky` exit zero.

### D5. Manifests for both skills

Sluice (15 cases) and bug-hunter (5 cases) each get a `rules.json` in this run,
and each README's "Running" section points at `eval:fresh`. The existing
hand-written verification history stays as history; new reads come from baselines.

### D6. First baselines

After the code lands: one two-arm pass per skill on `claude-opus-5-5`, `--runs 1`
first to check the plumbing end to end, then you decide whether to spend a
`--runs 3` pass before accepting it as the baseline. The `without` arm's key name in
the result JSON has never been seen in a completed run here (the one two-arm result
on disk was interrupted), so the plumbing check captures a real two-arm result as the
test fixture before the reducer is written against it.

## Not in this run

- The verification gates themselves (next run, measured by this one).
- New eval cases for `unpinned` rules; the manifest lists them.
- CI execution of the paid suite.
- Any automatic edit of a skill from a report.
