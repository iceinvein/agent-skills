# bug-hunter evals

Seven cases for `claude plugin eval`. Each scaffolds a small Node repo with a
`SPEC.md`, one module and a passing `node --test` suite, committed in two steps
(the spec, then the module) so the target reads as a change. The prompt asks
what QA will find in the module, the way a user would, and never names the
skill.

| Case | Fixture | What it pins |
|---|---|---|
| `proves-a-spec-boundary-bug` | Usernames are 3 to 20 characters inclusive; the code rejects 20 | A bug in `findings.json` citing the limit, with a repro that fails against the fixture |
| `silent-spec-is-an-ambiguity` | Quantities are "capped"; the spec never says where, the code uses 99 | The cap lands in `ambiguities` and `bugs` is empty |
| `correct-code-has-no-bugs` | Pagination that meets every stated range at its edge | `bugs` is empty |
| `callers-tree-unchanged` | A backoff whose first delay is doubled | Nothing changes in the caller's tree outside `.bug-hunter/` |
| `scenarios-before-bodies` | A coupon that floors where the spec rounds half up | `scenarios.md` is written before any `Read` of `src/discount.js` |
| `spec-outranks-target-docstring` | The spec keeps a sealed export on offer when its rewrite fails; the module's docstring and code drop it | A bug citing the spec claim, not an ambiguity between spec and docstring |
| `impossible-value-is-a-bug` | The spec is silent on rounding; the code shows `60s` and `1m 60s` | A bug for the seconds field of 60, which no rounding rule gives |

Every case also has `bug-hunter-fired`, a `tool_used: Skill` grader, so a
score can be told apart from the model's own habits.

## Running

From the repo root. Pin the model, because the eval child does not inherit
it, and pin the judge, because `--model` does not reach it:

```bash
claude plugin eval skills/bug-hunter --scaffold --allow-tools Bash Write Edit \
  --model claude-opus-5-5 --judge-model claude-opus-5-5 --runs 1 --ablation none
```

Add `--keep-temp` to keep each run's sandbox and trace, which is the only way
to read back why a grader failed. `-j 7` runs the seven cases at once.

## What the graders can and cannot see

The run directory is `.bug-hunter/<date>-<slug>/` and the slug is the skill's
choice. Only `file_exists` resolves a glob; a `regex` or `llm` grader pointed at
a file needs its exact path and throws on a glob. So:

- `findings-written` checks the file exists, by glob.
- Every grader that reads the *content* of `findings.json` reads the trace
  instead: the Write tool call, or the shell command, that created it. The
  regex graders (`bugs-empty`, `cap-is-an-ambiguity`) need the JSON to appear
  there as a literal, which holds for a Write call or a heredoc. **They cannot
  see a `findings.json` that a script builds** (`python3 -c` with `json.dump`,
  `node -e` with `JSON.stringify`): the trace then holds the script, not the
  JSON, and the grader fails whatever the file says. The baseline hit this.
  Both judge only the **last** write of `findings.json`: a closing lookahead
  fails the match if any later write of it follows (a Write, an Edit, or a
  shell redirect). Before 0.2.1 they passed on any write, so an empty first
  draft rewritten with bugs passed `bugs-empty`. A later Edit fails them,
  since an Edit's trace entry does not carry the whole file.
- `bug-cites-the-limit` is an `llm` judge over the trace, so it can read a
  script that builds the file as well as a literal. It sees a head-and-tail
  window of a long trace (about 80k characters of head, 20k of tail), so a
  findings write that lands in the dropped middle is invisible to it. It cannot
  run the repro; "fails in the fixture" is judged against the fixture's code,
  which the rubric quotes. Its rubric also says to judge only the last write.
- `tree-unchanged` cannot run `git status --porcelain`. It reads the harness's
  `files` target, the list of paths the run created or changed in its working
  directory, and fails on any path outside `.bug-hunter/` or `.git/`. It is
  stricter than porcelain (a file `.gitignore` hides still counts). A run that
  writes nothing passes it, which is why the case also has `bug-hunter-fired`.
- `scenarios-before-bodies` reads the chronological trace, which carries the
  tool calls of dispatched agents as well as the main thread's (each marked
  with `parent_tool_use_id`), so a scenario author's Write and an executor's
  Read are both visible. It sees `Read` calls on `src/discount.js` and the
  `scenarios.md` write (a Write call or a shell redirect). It does not see the
  body reached another way: `cat` or `sed` in Bash, Grep with content output,
  or source pasted into a dispatch prompt. A grep for declaration lines, which every baseline run used to extract
  signatures, is not counted.

## Baseline

### Skill 0.4.0, Opus 5.5, 2026-10-13

Same command, `-j 7`. Skill 0.4.0 drops the three dispatched roles for one
agent that may read the code freely, keeping intent collection, the scenario
catalog, a clean re-run of each failure and the 0.3.0 rules, and reporting
latent defects without filing them. It is the `variants/thin` arm of the
pilot benchmark, which proved or judged 3 of 12 answer keys against 2 for the
plain baseline and 2 for 0.3.0, with every extra finding triaged real, at USD
1.83 a run against 3.19 for 0.3.0. USD 3.74 in all, 102s,
`results/2026-10-13T03-48-17-313Z`. Overall 1.00. One run per case.

| Case | 0.3.0 | 0.4.0 | USD (0.4.0) |
|---|---|---|---|
| `proves-a-spec-boundary-bug` | 1.00 | 1.00 | 0.77 |
| `silent-spec-is-an-ambiguity` | 1.00 | 1.00 | 0.44 |
| `correct-code-has-no-bugs` | 1.00 | 1.00 | 0.34 |
| `callers-tree-unchanged` | 1.00 | 1.00 | 0.43 |
| `scenarios-before-bodies` | 1.00 | 1.00 | 0.49 |
| `spec-outranks-target-docstring` | 1.00 | 1.00 | 0.58 |
| `impossible-value-is-a-bug` | 1.00 | 1.00 | 0.70 |

`scenarios-before-bodies` passed, but 0.4.0 no longer asks for that order: the
run happened to write `scenarios.md` before reading `src/discount.js`. The case
pins a rule the skill dropped, so its pass is incidental and a later failure
would not be a regression.

### Skill 0.3.0, Opus 5.5, 2026-10-12

Same command, `-j 7`. Skill 0.3.0 ranks claims (a spec, design or request
outranks a docstring in the changed code), lets a result wrong under every
reading count as a bug against a `baseline` claim, and keeps ambiguities for
questions with more than one acceptable answer. It answers the pilot
benchmark, where 0.2.1 filed two real defects it had reproduced as
ambiguities. USD 6.55 in all, 228s, `results/2026-10-12T14-46-50-101Z`.
Overall 1.00. One run per case.

The two new cases also scored 1.00 on 0.2.1 (USD 0.91 and 1.07,
`results/2026-10-12T14-43-31-*`): at fixture size the conflict is plain enough
that the old rules got it right, so neither reproduces the pilot's miss. They
stay as guards against the opposite failure. The cases that pin over-reporting,
`silent-spec-is-an-ambiguity` and `correct-code-has-no-bugs`, still hold on
0.3.0: the cap stays a question and the correct module has no bugs.

| Case | 0.2.1 | 0.3.0 | USD (0.3.0) |
|---|---|---|---|
| `proves-a-spec-boundary-bug` | 1.00 | 1.00 | 1.29 |
| `silent-spec-is-an-ambiguity` | 1.00 | 1.00 | 1.07 |
| `correct-code-has-no-bugs` | 1.00 | 1.00 | 0.69 |
| `callers-tree-unchanged` | 1.00 | 1.00 | 0.62 |
| `scenarios-before-bodies` | 1.00 | 1.00 | 0.65 |
| `spec-outranks-target-docstring` | 1.00 | 1.00 | 1.35 |
| `impossible-value-is-a-bug` | 1.00 | 1.00 | 0.88 |

### Skill 0.2.1, Opus 5.5, 2026-10-12

Same command as 0.2.0 below. Skill 0.2.1 writes each findings `scenario` as
`"<id>: <label>"`, lets the single-agent fallback add a late claim from a
source other than the changed body, and the `findings.json` graders now judge
only the last write. USD 5.39 in all, 361s,
`results/2026-10-12T09-23-52-868Z`. Overall 1.00. One run per case.

| Case | 0.2.0 | 0.2.1 | USD (0.2.1) | Reading |
|---|---|---|---|---|
| `proves-a-spec-boundary-bug` | 1.00 | 1.00 | 1.01 | Judge PASS PASS PASS. `B1` is `"S2: a 20-character name is accepted"`, citing I1 |
| `silent-spec-is-an-ambiguity` | 1.00 | 1.00 | 1.04 | One `findings.json` Write, `bugs` empty; the cap question is `"S13: Quantity exactly at the cap, one below and one above"` |
| `correct-code-has-no-bugs` | 1.00 | 1.00 | 1.03 | One Write, `bugs` empty, 16 covered, two ambiguities (numeric strings, `Infinity`) |
| `callers-tree-unchanged` | 1.00 | 1.00 | 0.70 | No path outside `.bug-hunter/` changed |
| `scenarios-before-bodies` | 1.00 | 1.00 | 1.61 | Scenario author dispatched; `scenarios.md` written before any Read of `src/discount.js` |

Every `scenario` in every bucket of all five runs carried its label. Every
run wrote `findings.json` once, so the last-write rule changed no verdict
here; it was checked on doctored copies of the 0.2.0 traces (an empty draft
followed by a write with bugs, a later Edit, a later heredoc), where the old
patterns passed and the new ones fail. Every run dispatched at least one role
and wrote `intent.md` once, so the fallback's late-claim rule was not
exercised; no fixture has a sibling implementation or a stated invariant.

### Skill 0.2.0, Opus 5.5, 2026-10-12

Same command plus `--trust-plugin --no-publish`, CLI 2.1.296. Skill 0.2.0
counts intent stated in the repo itself (invariants the code states, sibling
implementations it says it mirrors, existing tests, docs) and requires
`findings.json` and `report.md` to be written with the Write tool. USD 5.08 in
all (judging USD 0.40), 265s, `results/2026-10-12T07-49-17-746Z`. Overall
1.00, against 0.84 for 0.1.0 below. One run per case, so every score is a
single sample.

| Case | 0.1.0 | 0.2.0 | USD (0.2.0) | Reading |
|---|---|---|---|---|
| `proves-a-spec-boundary-bug` | 1.00 | 1.00 | 1.33 | Judge PASS PASS PASS |
| `silent-spec-is-an-ambiguity` | 0.20 | 1.00 | 1.12 | `findings.json` written with Write, so both regexes see it. `bugs` empty; `A1` asks what the cap is and names the code's 99 |
| `correct-code-has-no-bugs` | 1.00 | 1.00 | 0.38 | `bugs` empty, 13 covered, one ambiguity (sparse arrays, which `SPEC.md` does not address) |
| `callers-tree-unchanged` | 1.00 | 1.00 | 1.17 | No path outside `.bug-hunter/` changed |
| `scenarios-before-bodies` | 1.00 | 1.00 | 1.08 | The dispatched scenario author wrote `scenarios.md` before any Read of `src/discount.js` |

No failures. The 0.1.0 failure is closed by the Write rule, not by a grader
change: all five runs wrote both files with the Write tool. The new intent
rule did not promote anything in the two cases it could have over-promoted:
the ambiguity run's five questions all stay ambiguities with `bugs` empty, and
the correct-code run's one open question (sparse arrays) stays an ambiguity.
None of the five fixtures has a sibling implementation or a stated invariant,
so these cases do not exercise the new confirm path; they only show it does
not leak into silent-spec cases.

Dispatch is still not reliable. The correct-code run ran all three roles in
the main thread with the Agent tool available (70s, the cheapest run); its
`intent.md` and `scenarios.md` were on disk before it ran `cat` on
`src/paginate.js`, so the fallback's order held. It hunted in a `$TMPDIR` copy
rather than a git worktree. The ambiguity run dispatched the scenario author
and executor and no refuter, which fits: no repro failed.

### Skill 0.1.0, Opus 5.5, 2026-10-12

CLI 2.1.296, `--model claude-opus-5-5 --judge-model claude-opus-5-5 --runs 1
--ablation none --keep-temp -j 5`. One run per case, so every score is a single
sample. USD 5.30 in all (judging USD 0.39), 317s,
`results/2026-10-12T05-33-00-761Z`. Overall 0.84, four of five cases at 1.00.

| Case | Score | USD | Reading |
|---|---|---|---|
| `proves-a-spec-boundary-bug` | 1.00 | 0.77 | Judge PASS PASS PASS. One bug citing I1 (3 to 20 inclusive) with a repro asserting a 20-character name is accepted |
| `silent-spec-is-an-ambiguity` | 0.20 | 0.97 | `bugs-empty` and `cap-is-an-ambiguity` fail on the grader's blind spot, not the skill (below) |
| `correct-code-has-no-bugs` | 1.00 | 0.98 | `bugs` empty; findings written with the Write tool |
| `callers-tree-unchanged` | 1.00 | 1.19 | No path outside `.bug-hunter/` changed; a look at the kept sandbox agrees |
| `scenarios-before-bodies` | 1.00 | 1.39 | The scenario author (a dispatched agent) wrote `scenarios.md`; the first Read of `src/discount.js` came later |

**`silent-spec-is-an-ambiguity` failed, and the skill did what the case
asks.** The run wrote `findings.json` with `python3 -I -` and `json.dump`, so
the trace holds a Python list, not the JSON the two regexes look for; both
report "pattern not found in trace". The file kept in the sandbox has
`"bugs": []` and, first among five ambiguities, `A1`: "What is the cap?
SPEC.md never gives a number; the code uses 99 (MAX_QUANTITY). Is 99 the
intended value, and should the spec say so?" The final message says the same.
The graders stay as written. The fix is not to widen them: either the skill
writes `findings.json` with the Write tool, which `findings-format.md` does not
ask for today, or the harness lets a file target take a glob. Which one is
open.

**Other things the traces show, which no grader scores.**

- Dispatch is not reliable. Four of the five baseline runs (ambiguity,
  correct, tree, order) dispatched the scenario author, executor and refuter
  as separate agents. The boundary-bug run, and the sanity run of the same
  case before it, ran all three roles in the main thread with the Agent tool
  available, which the skill reserves for when dispatch is unavailable. In
  both, `intent.md` and `scenarios.md` were on disk before the body was read,
  so the fallback's order held.
- Git inside the eval sandbox: a bare `git` is Apple's xcrun shim, which fails
  there (as in `skills/sluice/evals/README.md`), and so does the checkout step
  of `git worktree add` even from `/opt/homebrew/bin/git`. The tree run worked
  around it with `worktree add --no-checkout` then `reset --hard`, so it hunted
  in a real scratch worktree and removed it after; its own closing
  `git status --short` showed only `?? .bug-hunter/`. The order run fell back
  to `git archive` into `$TMPDIR`, and the boundary-bug, ambiguity and correct
  runs copied the files into `$TMPDIR` without git. The caller's tree stayed
  clean either way, but the skill's scratch worktree held the repros in one
  run of five.
- Before writing scenarios, the order run's main thread ran Grep with content
  output over `src/discount.js` for `export` and comment lines. That shows
  declaration lines, which the skill allows, but the same call shape could
  show a body, and the order grader does not count it.

**Sanity run before the baseline.** `proves-a-spec-boundary-bug` alone (USD
0.79, `results/2026-10-12T05-30-48-463Z`): 1.00. Its trace was then used to
check that each regex grader can fail. `scenarios-before-bodies`, pointed at
`src/username.js`, matched the real trace and did not match a copy with the
body's Read moved ahead of the `scenarios.md` write. `bugs-empty` and
`cap-is-an-ambiguity` did not match the real findings write (one bug, no
ambiguities) and did match a copy with `bugs` emptied and a cap question added.
`tree-unchanged` passed on a listing of only `.bug-hunter/` paths and failed
once `tests/backoff-hunt.test.js` was added. The `llm` grader's FAIL path was
not exercised: both runs of its case found the bug.
