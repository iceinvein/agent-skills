# terse benchmark

The eval suite in `../evals/` pins the rules. This answers a different
question: on a given model, does terse still cut output enough, at a quality
cost small enough, to be worth its prompt? Re-run it when a new model lands.

## What it runs

Thirty prompts in `prompts.json`, six in each category:

| Category | What it is |
|---|---|
| `fact` | One-fact questions with a one-line answer |
| `explain` | "How does X work" / "why does X happen" |
| `tradeoff` | "X or Y?" with a defensible recommendation |
| `debug` | A snippet or error message and "why?" |
| `task` | A small fixture repo and a request to fix or change it, with tools |

Each prompt runs in three arms, three samples each by default:

| Arm | System-prompt addition |
|---|---|
| `plain` | none |
| `concise` | `Be concise.` |
| `terse` | `SKILL.md` with the frontmatter stripped and the level set to `tight` |

`concise` is the arm that decides "worth it": if one line gets the same
savings, terse is not earning the ~4,000 input tokens it adds to every call
(4,075 in a one-off probe of terse 1.3.2; runs do not record input usage).

Every run is `claude -p` in an empty temp directory with `--setting-sources=`
and `--strict-mcp-config`, so the operator's CLAUDE.md, skills and hooks
(terse's own SessionStart hook among them) reach no arm. The child gets only
HOME, PATH, USER, LOGNAME, SHELL, TMPDIR, LANG and TERM from the shell, so an
effort or thinking override exported there cannot reach it either. Prose
prompts run with `--tools ""`; task prompts get Read, Edit, Glob, Grep and
`Bash(node:*)`. Each run record carries the CLI version and a sha1 of its
arm's system-prompt addition, which names the `SKILL.md` it measured.

The terse arm appends `SKILL.md` to the system prompt. In real use the skill
arrives as the result of a Skill tool call that its hook asks for, so the
benchmark measures the instructions, not the activation path.

## Measures

- **Visible tokens**: output tokens less thinking tokens, summed over the run's
  turns, from the CLI's `modelUsage`. For task prompts this includes the tool
  calls the model wrote.
- **vs plain**: per prompt, the arm's mean visible tokens over plain's, then
  the mean of those ratios. Long answers do not dominate it.
- **Checks**: task prompts carry a node check run in the workspace afterwards,
  killed after 30 seconds. Every check fails on the unfixed fixture and passes
  on a correct fix; the retry, config and pagination checks also fail the
  plausible wrong fixes review tried (retrying forever, accepting `"80abc"`,
  only ever returning page 0). A task run that errors counts as a failed check.
- **Judged**: Opus compares each reply with the plain reply of the same sample,
  shown in a fixed per-pair random order: same conclusion, points a reader
  would need that one reply lacks, factual errors, and which is easier to read.
  Plain is judged against another plain sample, which gives the noise floor:
  the "lost a needed point" rate two plain replies already show against each
  other. Read the other arms against that row, not against zero. The judge
  is noisy itself: the same 18 plain tradeoff pairs, judged five times, scored
  6%, 11%, 11%, 17% and 6%.
- For task prompts the judge sees only the final message, not the diff, so
  "lost a needed point" there grades the summary; the check grades the fix.

## Running

From the repo root:

```bash
D=skills/terse/bench/results/<name>
bun skills/terse/bench/bench.ts run --dir $D --model claude-opus-5-5
bun skills/terse/bench/bench.ts judge --dir $D --judge-model claude-opus-5-5
bun skills/terse/bench/bench.ts report --dir $D
```

`run` and `judge` append to `runs.jsonl` and `judged.jsonl` and skip what is
already there, so an interrupted pass resumes where it stopped and errored
runs are retried. `--prompts id,id` and `--arms terse` narrow a run, `--skill
path` runs the terse arm on another `SKILL.md`, and `--samples` and
`--concurrency` default to 3 and 6. `report` writes `report.md` next to them.
`results/` is gitignored.

One directory measures one prompt per arm: `run` refuses a directory whose
recorded runs came from a different prompt for the arm it is about to run. To
compare a `SKILL.md` version against an existing plain baseline, start a new
directory, copy the plain lines of the old `runs.jsonl` into it, and run with
`--arms terse --skill <path>`.

Keep the judge model fixed across benchmark runs you want to compare.

## Results

### Opus 5.5, terse 1.3.2, 2026-10-04

CLI 2.1.289, default effort, 270 runs (USD 10.68) judged by Opus 5.5
(USD 9.57). Directory `results/opus-5-5-2026-10-04`.

| Arm | Visible tokens | vs plain | Thinking | Lost a needed point | Conclusion changed | Incorrect | Easier to read: arm / same / plain |
|---|---|---|---|---|---|---|---|
| plain | 622 | 0% | 31 | 8% (noise floor) | 0% | 3% | 19 / 46 / 25 |
| concise | 455 | -26% | 21 | 13% | 0% | 4% | 64 / 18 / 8 |
| terse | 384 | -39% | 75 | 19% | 1% | 2% | 75 / 11 / 4 |

By category, terse against concise (visible tokens vs plain; lost a needed point):

| Category | concise | terse |
|---|---|---|
| fact | -30%; 0% | -47%; 0% |
| explain | -32%; 22% | -48%; 17% |
| tradeoff | -26%; 17% | -48%; **50%** |
| debug | -28%; 11% | -40%; 11% |
| task | -13%; 17% | -12%; 17% |

Every task check passed in every arm (15/15 each), against the checks as they
stood then. Review later found that the retry and config checks passed some
wrong fixes, and they were tightened; the workspaces are gone, so those runs
cannot be re-checked.

**Length and readability.** Terse cuts 13 points more than "Be concise." and
the judge preferred its reply to plain in 75 of 90 pairs against 64 for
concise. The gain is all in chat-style answers. On tool-using tasks terse and
concise cut the same 12-13%.

**Tradeoffs lose content.** Half of terse's tradeoff replies dropped something
the judge called necessary, against 17% for concise and an 11% noise floor.
What went was caveats on the recommended option (UUIDv7 leaks a creation
timestamp) and middle-ground alternatives (REST `?fields=` / `?expand=` instead
of GraphQL). One `tradeoff-orm` reply was judged to change its conclusion and
contradicted itself on Kysely codegen. Terse's tradeoff answers also think far
more (212 thinking tokens against 16 for plain), which is the Semantic
Preservation rule to reason at full depth before compressing.

A rerun of the tradeoff prompts on terse 1.3.1, before the "full depth belongs
in thinking" bullet (`results/opus-5-5-2026-10-04-terse-1.3.1-tradeoff`, same
plain replies; USD 1.10 for the 18 new terse runs and 1.42 for judging, which
re-judged the plain noise pairs too. Its `report.md` shows 1.63 for runs
because it counts the copied plain runs.): -30% tokens, 39% lost a needed point,
22% judged incorrect somewhere. Both versions drop tradeoff content at several
times the noise floor; 18 pairs each cannot separate 39% from 50%.

**Cost.** The cost-per-run column is not what terse costs in use. Each run here
starts a fresh session in a fresh temp directory, so terse's ~4,075 extra
system-prompt tokens are written to the cache every run (USD 0.033 at the 1h
write price). In a session they are written once and then read on every API
call, at USD 0.20 per million: about USD 0.0008 a call. At USD 20 per million
output tokens, terse saves about USD 0.0039 a turn against plain counting
thinking (652 to 459 output tokens), so it pays back its cache write after
about ten turns. Against concise (475 output tokens, no extra prompt), terse
saves 16 output tokens a turn (USD 0.0003) and pays USD 0.0008 to read its
prompt: concise is cheaper on every turn. In tool loops, where one turn is many
API calls, terse's read cost multiplies while its savings over concise are nil.

**Verdict for Opus 5.5.** Terse is not worth it for cost: a one-line "Be
concise." gets two thirds of the cut for free. Terse buys shorter, better-read
answers to questions, at the price of dropped caveats on tradeoff questions, which 1.3.3 addresses
below.

### Tradeoff caveats, terse 1.3.3

1.3.3 rewrites the 1.3.2 bullet so a tradeoff reply keeps any catch in the
recommended option that changes how the reader should use it, and any middle
ground that gets most of the losing side's benefit, while still dropping setup
tips. The 1.3.2 row is the main run's tradeoff slice; every other row reruns
the six tradeoff prompts, terse arm only, three samples, against the same
plain replies, judged by Opus 5.5 (about USD 2.50 a row). "Noise" is that
row's own plain-against-plain rate.

| Version | vs plain | Lost a needed point (noise) | Conclusion changed | Incorrect |
|---|---|---|---|---|
| 1.3.1 | -30% | 39% (6%) | 0% | 22% |
| 1.3.2 | -48% | 50% (11%) | 6% | 6% |
| 1.3.3, first draft | -38% | 11% (11%) | 0% | 6% |
| 1.3.3, examples moved off the bench | -37% | 11% (17%) | 0% | 22% |
| 1.3.3 as shipped | -41% | 11% (6%) | 0% | 6% |

The first draft's examples (UUIDv7, REST `?fields=`) were taken from two of the
benchmark's own prompts, so its row is contaminated; the shipped wording uses a
message-broker example no prompt touches. The middle row's 22% incorrect were
factual slips inside the caveats it now kept (Render's private networking,
Prisma TypedSQL); with 18 replies a row that is 4 against 1. That draft also
let a configuration tip back in as "one catch" (`STRICT` tables), which the
eval suite's `adds-nothing-unasked` grader failed once in three; the shipped
wording says a setting to turn on is not a catch, and the grader passed 3/3.

The cost: tradeoff replies think more than any other category (282 thinking
tokens against 16 for plain), so the total-output saving on tradeoffs is
smaller than the visible one.

### Not measured

Other models, `clean` and `sharp`, effort levels other than the
default, and the skill's real activation path (a Skill tool call from the
SessionStart hook rather than an appended system prompt). The judge is Opus
judging Opus, and three samples per cell gives each category 18 pairs.
