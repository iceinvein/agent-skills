---
name: bug-hunter
description: Use when asked to hunt for bugs or edge cases in a change or area, to say what QA will find before QA does, or to prove a change correct. Runs QA-style scenarios as failing reproductions in the repo's own test runner and reports only bugs it can prove, plus the questions intent leaves open.
argument-hint: "[<commit>|<base>..<head>|<path>...]"
---

# Bug hunter

Agent-written code passes its own tests and still fails when QA hits a
scenario nobody wrote down. This skill runs the code and proves each bug with
a failing reproduction, checked against what the change was meant to do.

## Method

1. **Name the target** in one line: a diff (a commit, a range, the working
   changes) or a set of paths, taken from the arguments when given and the
   working changes otherwise. Every later step is scoped to it.
2. **Collect intent** into `intent.md`: numbered claims (`I1`, `I2`, ...),
   each one checkable statement with its source. Sources are the request or
   ticket, commit messages, specs and designs, docs, `CLAUDE.md`/`AGENTS.md`,
   invariants stated in unchanged code, sibling implementations the target
   says it mirrors, and existing tests on unchanged code. Read the target's
   code as much as you need, but a claim never comes from what a changed body
   does: that is the code confirming itself.
3. **Hunt.** Write scenarios the way QA would into `scenarios.md` (`S1`,
   `S2`, ..., each with a one-line label, the expected result and the claim
   it rests on), working through `references/scenario-catalog.md`, adding
   more as the code and failures suggest. For each one worth trying write a
   repro in the repo's own test framework that asserts the expected result.
   Find the runner from the repo's manifests and `CLAUDE.md`/`AGENTS.md`; do
   not install a test dependency. Favour many cheap probes over a few
   elaborate ones, and chase what a failure suggests.
4. **Check each failure before reporting it.** Run its repro alone, clean,
   with only its own files, and confirm it fails with the observed value.
   Confirm the repro tests the target and not its own setup: a mock returning
   what the real dependency never would, or a fixture breaking an invariant
   the caller guarantees, is not a bug.
5. **Sort** each result with the rules below, and write the output.

Work in a scratch copy (a `git worktree`, or the copy the caller names). Never
modify the caller's tree: no repro, install or build artefact lands there.

## What counts as a bug

No repro, no finding: a bug carries a reproduction that fails in a clean run
and names the claim it violates.

- **A concrete claim, contradicted,** is a bug citing that claim.
- **Claims have a rank.** The request, ticket, spec or design outranks a
  docstring or comment inside the target's changed code, which is the change
  describing itself. A target that follows its own docstring against the spec
  is a bug citing the spec. Only claims of the same rank that disagree make an
  ambiguity.
- **Some results are wrong under every reading,** and need no stated claim: a
  crash, an error or a blank page from input the target accepts; a call that
  reports success and did not do the work; an earlier action's result landing
  over a later one's; a value shown in a form no reading allows, such as a
  seconds field of 60; one user's data reaching or blocking another user. Add
  the one you rely on to `intent.md` with source `baseline`.
- **An ambiguity is a question with more than one acceptable answer,** where
  the code picked one and no claim says which: where a cap sits, whether a
  match ignores case. "No spec says so" is not enough; if every acceptable
  answer makes the observed result wrong, it is a bug.
- **Latent is not a bug.** A defect on a path no production caller reaches
  today is noted in `report.md`, not filed in `bugs`.

## Output

Write to `.bug-hunter/<YYYY-MM-DD>-<slug>/` at the repo root: `intent.md`,
`scenarios.md`, `report.md` for a human, and `findings.json` for a grader or calling skill,
in the shape `references/findings-format.md` gives. Three buckets: **bugs**
(scenario, violated claim, expected against observed, repro files and
command), **ambiguities** (the question for product), **covered** (scenarios
that passed, with the claim each checked). Write `findings.json` and
`report.md` with the Write tool, never from a shell command or script.

The `.bug-hunter/` directory is the one path in the caller's tree the skill
writes. Promoting a repro into the tree as a regression test is the caller's
job.

The directory ignores itself, so no repo has to add a line for it: if
`.bug-hunter/.gitignore` is absent, write it holding `*` before anything else
in the run. Leave an existing one alone; deleting it is how a repo chooses to
commit its runs.

## Hand-back

The run directory, the counts per bucket, then each bug in one line:
scenario, violated claim, repro command. Name anything not done.
