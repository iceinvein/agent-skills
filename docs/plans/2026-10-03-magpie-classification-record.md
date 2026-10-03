# Run record: magpie-classification

Plan: `docs/plans/2026-10-03-magpie-classification.md`. Design: `docs/specs/2026-10-03-magpie-classification.md`.
Task status lives in `.sluice/run.json`, not here.

## Pre-flight

- **Review: the flip (task 6) and the final review only.** Agreed with the partner's "ok" on the
  recommended options. Tasks 1-5 and 7 are code with unit tests written first. The flip is prose
  that no test executes, so that's where a reviewer pays for itself. The final review is the only
  integration check across the code tasks; the other seven tasks ship unreviewed by choice.
- **Effort: all 8 at session effort.** Every task has a judgement call in it (re-anchor rules,
  batch splitting that keeps merge groups whole, prompt wording), so none is mechanical.
- **Workspace: one worktree (`worktree-magpie-classification`), serial implementers, each agent
  commits its own task.** At most two tasks could overlap, and tasks 3, 4 and 5 all touch
  `bin/magpie.ts`, so the second worktree would buy little.

## Notes

- Baseline before task 1: 449 tests green in `skills/magpie`.
- `bun run typecheck` cannot run on this machine: `tsc` is not installed and is not a dev
  dependency. Implementers run `bunx -p typescript tsc --noEmit` instead (T1 exit 0). Adding
  typescript as a dev dependency would need the partner's say-so, so it was not done.
- T1 deleted `coerceSeverity` and its synonym tables (no other importer).
- T3: merging a finding with `domain: null` records `mergedFrom.domain: 'unknown'`, matching the
  existing dedupe.ts behaviour. That's a default for missing data. It was kept consistent with
  dedupe and flagged at the handback, rather than changed in one place only.
- T4 Touches corrected mid-run: `renderAnnotation` is reached only through `render-diff.ts` and
  `render-issues-list.ts`, so both (and their tests) were added and the dismissed map is threaded
  as a required input. The implementer stopped and reported instead of editing outside Touches;
  the browser-side alternative was rejected as moving rendering into the client.
- T4 left `RenderFindingsInput.dismissed` optional because `refresh.ts` (serve/open re-render)
  and `preview-cmd.ts` were outside its Touches. T5 already threads `topN` through the same path,
  so `refresh.ts`, its test, `render-findings.test.ts` and `preview-cmd.test.ts` joined T5's Touches;
  T5 makes `dismissed` required and has refresh read `readDismissed`.
- T4 also started logging per-id post events from `postFindingsAsReview` (the review path never
  wrote to log.jsonl), which `via` needed. Invalid lines in `state/events` or `log.jsonl` make
  `magpie labels` (and so `cleanup`) fail loudly.
- T6: `claude plugin eval` could not run in this session. The worktree guard reads the word
  `eval` as shell eval and refuses the command, for the implementer and for the controller alike.
  The five stage cases are unverified until the partner runs them with `!`.
- T6 relabelled the per-focus risk guides from severity words to `risk.impact` values, and fixed
  older fixture inconsistencies in codex-missing-falls-back (an invalid `unlikely` likelihood,
  scores that didn't match `scoreRisk`, a stale brief shape). SKILL.md sits at 2958 of the 3000
  word lint cap.
- T7 dispatched while T6's reviewer was out: Touches are disjoint and `status.sh ready` cleared it.
- T6 review (773467d): nothing blocking, 8 minor. Going back to the implementer after T7 commits
  (the shared tree means no two implementers at once): critic-apply JSON parse error to name the
  file (critic-cmd.ts joins T6's Touches), retry cap in stage 6, resume wording, batch size wording,
  `--top` dropped from the walkthrough because serve/re-render don't persist it, evidence-dropped
  only written when non-empty, critic prompt to cover null-line/no-evidence findings and mention
  the design cap, evals README overstatement.
- T7 baseline (no LLM, original pipeline's kept set vs labels): 240 kept, 139 posted, precision
  0.58 overall (per run 0.10 to 0.93). Recall is 1.00 by construction for the baseline. No run has
  dismiss events yet. Saved to `~/.magpie/corpus/results/2026-10-03T02-53-09-213Z-baseline.json`.
- T7: `claude -p` has no `--max-cost-usd`, so replay-full maps it to `--max-budget-usd`.
  `evals/quality` is outside biome's lint scope (`biome.json` covers bin/ and scripts/), so it was
  formatted through biome stdin. Neither replay has run.
- T8 blocked: the worktree guard refuses git against any other repo, and critic replay has to cut a
  worktree in the reviewed repo (`~/Documents/projects/workings` for 6 of the 8 runs). Driving it
  through a bun script would only hide the git calls from the guard, so it wasn't done. Handed to
  the partner with the exact commands.
- Final review (9116ef9..21aa0dc): 1 blocking, 14 minor. The blocker: refresh pruned the old
  findings.html before `readDismissed` could throw, and open/serve swallowed the error. One fix
  agent was sent items 1-8 (blocker, merged-into-capped loss, dry-run posts labelled posted,
  posted+dismissed fold, select-by-severity picking dismissed, replay batch kill and error text,
  stale drop files, critic duplication rule). Not taken:
  - unknown `via` dropped silently (a settled T4 choice: never reject a post over telemetry)
  - corpus guard checks only this checkout
  - `--top` exit code 1 vs 2
  - cleanup leaving a half-done run on a bad events line (it fails loudly, which is the intent)
  - helper.js tests read source text, matching the file's existing pattern; a DOM check would need
    agent-browser or a new dependency
- T8 partial (partner ran it): critic replay on pr-70, $1.55. Kept 5 (was 18), precision 1.00
  (was 0.50), recall 0.44 (was 1.00). Of the 9 posted findings it dropped 5: architecture-s5-3,
  architecture-s5-4, code-smells-s4-1, code-smells-s5-1, security-s5-1. Four are design-domain,
  and the 3 design keeps hit the cap exactly, so the cap is the likely cause but unconfirmed: the
  replay deletes its scratch dir and the result file doesn't keep `critic-dropped.json`. Kept
  `code-smells-s4-5` has no label (the original critic dropped it), so it's left out of precision,
  which overstates it.
- T3: the cap test uses 7.1 instead of 7.0 because no risk combination scores exactly 7.0.
