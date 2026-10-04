# terse evals

Eight cases for `claude plugin eval`, one rule from `SKILL.md` each. Terse is a
prompt-only skill, so what a case can pin is the reply: how long it is, which
words it uses, whether the recommendation in it survived compression, and where
compression was supposed to stand down.

| Case | Signal under test | What it pins |
|---|---|---|
| `short-answer-stays-short` | A one-fact question | O(log n) in forty words or fewer; terse never pads |
| `recommendation-leads-and-holds` | A tradeoff with one right answer | SQLite in the first sentence, not hedged later, no generic hedge, and no advice the question did not ask for |
| `explanation-has-no-recap` | A conceptual "why" | Correct explanation and fix; no opener, no question echo, no closing summary |
| `plain-register` | A question that invites slide-deck words | Concrete rate-limit advice with none of the Register list (leverage, robust, seamless, ...) |
| `security-warning-survives-sharp` | `sharp` plus disabling TLS on a production webhook | The MITM warning in a full sentence and a real fix: auto-clarity beats the level |
| `commit-message-written-normally` | `sharp` plus "write a commit message" | The message is ordinary prose: Boundaries keep artefacts out of compression |
| `sharp-compresses-structure` | `sharp` on an explanation | Arrows, 120 words or fewer, and the ETag / If-None-Match / 304 round trip intact |
| `fix-reports-the-cause` | A one-file bug fix | The fix lands; the handback states cause and change without retelling the steps |

## Running

Only `fix-reports-the-cause` scaffolds a file and edits it. From the repo root:

```bash
claude plugin eval skills/terse --scaffold --allow-tools Edit \
  --model claude-opus-5-5 --judge-model claude-opus-5-5
```

Pin both models: the eval child does not inherit the session's model, and
`--model` does not reach the judge, which otherwise runs on Haiku.
`--runs 1` is the cheap iteration loop. Keep the no-plugin arm (the default):
for this skill the delta is the result, because a capable model already avoids
some of what terse cuts, and a case that scores 1.00 in both arms is measuring
the model rather than the skill.

## Grader notes

Length is pinned with a word-count regex on the last message, `(\S+\s+){N}`
with `match: not_contains`, because the runner has no length or token grader.
It matches once N words each have whitespace after them, so a reply fails at
N+1 words. It counts code and markup as words, headings and backticked headers
included.

The phrase list in `no-closing-recap` only catches a recap that announces
itself ("in summary", "to recap"). A closing paragraph that restates the
explanation without a marker phrase passes it.

The phrase graders (`no-preamble`, `no-closing-recap`, `no-consultant-words`)
read `last_message`, never the trace: the trace carries `SKILL.md`, which names
every phrase they ban.

`SKILL.md`'s ban on "Let me" / "I'll" before a tool call cannot be checked
here. In every `fix-reports-the-cause` trace, both arms, Opus 5.5 ran its tool
calls with no text block between them: whatever it wrote between calls came
back as a thinking block or not at all, which the sluice README also records.
An earlier `no-action-narration` regex over the trace passed every run because
there was nothing for it to read, and it was removed. The case now judges the
handback, where narration would still show.

Every prompt asks for terse in words ("Terse mode", "Terse mode, sharp
level"), because the skill's own trigger is the user asking for it. A leading
`/terse` is not expanded as a slash command in the eval child, and in the first
pass the model never loaded the skill from it, so no prompt uses that form. The
no-plugin arm gets the same words, so it measures what the model does with the
request alone.

`tool_used: Skill` graders are excluded from the score in a two-arm run and
reported as indicators of whether the skill fired.

## Not covered

- **Persistence across turns.** `SKILL.md` says terse holds every response
  until "stop terse". The runner takes multi-turn context only as a resumed
  `.jsonl` transcript (`context.history_file`), and no case carries one yet.
- **Token savings.** The "20-30%" claim in the description is not measured: the
  results carry cost per run but no output-token count, and traces are deleted
  unless `--keep-temp` is passed.
- **The `clean` level** has no case of its own; `tight` is the default and is
  what the unlabelled prompts exercise.

## Verification status

### Opus 5.5, 2026-10-04

`--model claude-opus-5-5 --judge-model claude-opus-5-5 --runs 3`, both arms.
USD 7.07 for the suite, `results/2026-10-04T01-13-48-779Z`. The skill fired in
all 24 with-arm runs. Word counts are the final reply in each run.

| Case | With | Without | Δ | Reply words, with | Reply words, without |
|---|---|---|---|---|---|
| `short-answer-stays-short` | 1.00 | 1.00 | 0.00 | 10, 12, 10 | 21, 34, 18 |
| `recommendation-leads-and-holds` | 1.00 | 0.93 | +0.07 | 203, 124, 146 | 68, 100, 100 |
| `explanation-has-no-recap` | 1.00 | 1.00 | 0.00 | 70, 90, 77 | 86, 83, 105 |
| `plain-register` | 1.00 | 1.00 | 0.00 | 292, 316, 302 | 312, 295, 283 |
| `security-warning-survives-sharp` | 1.00 | 1.00 | 0.00 | 212, 181, 182 | 163, 192, 149 |
| `commit-message-written-normally` | 1.00 | 1.00 | 0.00 | 53, 43, 91 | 29, 37, 34 |
| `sharp-compresses-structure` | 0.67 | 0.56 | +0.11 | 202, 199, 242 | 251, 262, 222 |
| `fix-without-narration` (now `fix-reports-the-cause`) | 1.00 | 1.00 | 0.00 | 35, 42, 34 | 42, 35, 25 |

Mean delta +0.02. On Opus 5.5 the words "Terse mode" in the prompt get the
no-plugin arm past nearly every grader on their own, so the suite pins
regressions in the rules rather than showing what the skill adds.

These scores predate the review fixes below (the narration grader removed, the
caveat rubric narrowed, the log-n and recap patterns corrected), so they are
the suite as it was, not as committed.

What the word counts show that the scores do not:

- **The skill lengthens tradeoff answers.** In `recommendation-leads-and-holds`
  every with-arm reply was longer than every no-plugin reply (mean 158 words
  against 89). The with arm keeps the same verdict and adds bullets the question
  did not ask for ("widely used for this", WAL mode, backup advice). That breaks
  `SKILL.md`'s own rule that terse never makes a response longer. The likely
  source is the Semantic Preservation section, which asks for full-depth
  reasoning and load-bearing caveats on exactly this kind of question. No grader
  catches it, because "longer than the other arm" is not expressible.
- **Short answers and `sharp` do get shorter**: 11 words against 24, and 214
  against 245.
- **The commit messages ran longer with the skill** (mean 62 against 33), but
  Boundaries puts commit messages outside compression, so that is not a
  violation.

The no-plugin arm's one `keeps-a-real-caveat` failure was a 68-word reply that
named no condition under which Postgres would win. Review judged that a correct
answer, since the prompt had already ruled out a server and several users, so
the grader now fails only generic hedging; under it that run would pass and the
case's delta would be 0.00.

`sharp-compresses-structure` fails `stays-under-120-words` in every run of both
arms. The cap is a judgment rather than a number from `SKILL.md`, kept at 120
on purpose: the with-arm replies answer the question in the first block and
then add `If-Match` on writes, weak ETags and load-balancer gotchas, which is
the padding `sharp`'s "top 3-5 points only" is meant to cut. The no-plugin arm
also misses `uses-arrows` in two of three runs, which is the only grader in
this case where the skill made a difference.

### Tradeoff padding fix, terse 1.3.2

`adds-nothing-unasked` was added to `recommendation-leads-and-holds` to catch
the padding above, and run before the fix (`--runs 3`, both arms, USD 1.35):
the with arm failed it in two of three runs and the no-plugin arm in one, a
delta of -0.10. `SKILL.md` 1.3.2 adds one Semantic Preservation bullet: full
depth stays in thinking, and the reply is the verdict, the deciding reasons and
the condition that would flip it. After it (USD 1.24,
`results/2026-10-04T01-22-59-150Z`) the with arm passed 3/3 and the no-plugin
arm 1/3, a delta of +0.19. A single with-arm pass over the whole suite
afterwards (USD 1.47) matched the earlier scores case for case.

The with arm's replies still ran longer: 124, 132 and 101 words against 85, 56
and 63. They carry no unasked advice any more; the difference is wordier
bullets ("which is a lot of overhead for a desktop app"), so tight-level
compression is not biting on tradeoff answers. That gap is open.
