---
name: bug-hunter
description: Use when asked to hunt for bugs or edge cases in a change or area, to say what QA will find before QA does, or to prove a change correct. Writes QA-style scenarios from stated intent before reading the code, runs each one as a failing reproduction in the repo's own test runner, and reports only bugs it can prove, plus the questions intent leaves open.
---

# Bug hunter

Agent-written code passes its own tests and still fails when QA hits a
scenario nobody wrote down. Review gives an opinion on a diff; this skill runs
the code and proves each bug with a failing reproduction checked against what
the change was meant to do.

## No repro, no finding

A bug is reported only with a reproduction that fails in a clean run and names
the intent claim it violates. A suspicion without a failing repro is not a
finding. A failing repro whose expected value no claim supports is an
ambiguity, a question for whoever owns the intent, never a bug. A repro that
shows the target contradicting a concrete claim the repo makes about it (an
invariant the code states, a sibling implementation it says it mirrors, an
existing test, a doc) is a bug citing that claim, not an ambiguity.

## Input

- **Target:** a diff (a commit, a range, or the working changes) or a set of
  paths. Name it in one line before starting; every later step is scoped to it.
- **Intent sources:** the request or ticket text the caller passes in, commit
  messages, specs and docs in the repo, `CLAUDE.md`/`AGENTS.md`, the
  docstrings and types on the changed signatures, invariants the code states
  about itself in comments, sibling or mirrored implementations the target
  says it matches, and the repo's existing tests. Intent is what the change
  was meant to do, which is a different thing from what it does.

If no intent source states anything checkable about the target, say so and
stop. Hunting without intent can only confirm the code against itself.

## Intent before implementation

An agent that reads the code first takes its expected values from the code and
confirms the bug as a feature. So the roles run in order, each as a separate
dispatch (the `Agent` tool), and the scenario author never sees a changed
function body. Briefs for all three are in `references/roles.md`; pass each
role its brief and only the inputs it names.

1. **Scenario author.** Reads intent sources, changed signatures and exports,
   callers, and existing tests. Does not open changed bodies. Writes
   `intent.md` (numbered claims, each with its source) and `scenarios.md`
   (QA-style scenarios, each with an expected result tied to a claim), drawing
   probes from `references/scenario-catalog.md`.
2. **Executor.** Sees everything. Finds the repo's own test runner from its
   manifests and `CLAUDE.md`/`AGENTS.md`, writes one runnable repro per
   scenario worth trying in the repo's own test framework, and records each as
   pass or fail.
3. **Refuter.** Takes each failing repro plus `intent.md`. Re-runs it clean,
   and checks the expected value follows from a cited claim. Confirms it as a
   bug, demotes it to an ambiguity, or rejects it.

Do not hand the executor's reasoning to the refuter. A refuter that reads why
the executor believed in a bug is persuaded rather than checking.

## Scratch worktree

All hunting happens in a scratch `git worktree` created from the target's
commit (or from `HEAD` with the working changes applied, when the target is
uncommitted work). The caller's tree is never modified: no repro, exploratory
test, install or build artefact lands there. Exploratory test files stay in
the scratch worktree; only confirmed repros travel out, as file contents inside
`findings.json`. Remove the worktree when the run ends.

Promoting a repro into the tree as a regression test is the caller's job. The
skill reports; it never commits, stages or edits the caller's files.

## Output

Each run writes to `.bug-hunter/<YYYY-MM-DD>-<slug>/` at the caller's repo
root, where the slug names the target in a few words:

- `intent.md` and `scenarios.md`, from the scenario author.
- `report.md`, for a human reader.
- `findings.json`, the same content for a grader or a calling skill.

Both reports sort results into three buckets:

- **bugs:** confirmed by the refuter. Each carries the scenario, the violated
  claim, expected against observed, and the repro (files and command).
- **ambiguities:** a scenario where intent is silent or contradicts itself,
  stated as a question for product.
- **covered:** scenarios that ran and passed, with the claim each one checked.

Shapes and layout are in `references/findings-format.md`. Write
`findings.json` to that shape exactly; a caller parses it. Write
`findings.json` and `report.md` with the Write tool, never from a shell
command or a script, so their contents appear literally in the run's trace.

The `.bug-hunter/` directory is the one path in the caller's tree the skill
writes. Say in the hand-back if it is not in `.gitignore`, rather than editing
`.gitignore` yourself.

## Single-agent fallback

Where dispatch is unavailable, one agent runs the three roles in sequence and
the order is the whole safeguard:

1. Read intent sources, changed signatures and exports, callers and existing
   tests. Do not open a changed function body.
2. Write `intent.md` and `scenarios.md` to the run directory. Both exist on
   disk before any changed body is opened.
3. Only then open the bodies, and execute in the scratch worktree.
4. Refute each failure as the refuter brief says, citing the claim from
   `intent.md` as written in step 2. Do not edit `intent.md` or
   `scenarios.md` after step 2; a claim discovered later is an ambiguity.

The friction line: "I need to read the function to know what to test." You need
to read its signature and its callers. The body tells you what it does, which
is the one thing a scenario must not be anchored to.

## Hand-back

Report the run directory, then the counts per bucket, then each bug in one
line: scenario, violated claim, repro command. Name anything not done:
scenarios not executed and why, a test runner that could not be found, a
repro that would not run clean.
