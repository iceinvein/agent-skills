---
name: cover-letter-audit
description: >
  Score a cover letter on a 100-point scale across four categories: content and
  fit (35), structure (20), voice and humanness (25), correctness (20). Detects
  AI-generated-content signals (burstiness, known AI phrase list, vocabulary
  diversity, em-dash count), checks that every claim aligns with the resume,
  validates job-description coverage without keyword stuffing, flags filler
  openers, and produces a prioritized fix list. Works with markdown, DOCX, PDF,
  or pasted letter text. Use when the user says "audit cover letter", "score
  cover letter", "review cover letter", "check cover letter for AI", "does this
  cover letter sound human", "rate my cover letter", "is this cover letter any
  good", or shares a finished letter and asks for feedback.
argument-hint: "<letter-file-or-text> [--resume <file>] [--jd <file|url|text>] [--format md|json|table]"
---

# Cover Letter Auditor

Score a cover letter and return prioritized fixes. The score combines four
categories to 100 points. A letter at 85+ is publishable; below 75 needs
targeted rework; below 60 should be rewritten.

## Inputs

Required:

- **Letter**: path to `.md`, `.mdx`, `.docx`, `.pdf`, or pasted text.

Optional but strongly recommended:

- **Resume** (`--resume <file>`): enables evidence-alignment check. Without it,
  skip that subcheck and note this in the report.
- **Job description** (`--jd <file|url|text>`): enables coverage check. Without
  it, skip that subcheck and note this in the report.

Flags:

- `--format md|json|table` (default md)
- `--strict` (tighter thresholds; see "Strict mode" below)

## Parsing

Same extraction tools as `cover-letter-write`. If the letter is a DOCX or PDF,
convert to markdown first via pandoc or pdftotext.

## Scoring rubric

Total: 100 points, grouped into four categories. Each check reports points
earned, max, and a short note.

### 1. Content and Fit (35)

| Check | Points | Pass criteria |
|-------|--------|--------------|
| Specificity | 8 | Company name and role both present; at least one concrete detail about the company or team (product, mission, tech, recent news) appears in the opening |
| Evidence alignment (requires resume) | 10 | Every factual claim about the applicant maps to a resume bullet. Minus 2 per unsupported claim. |
| Evidence quality | 7 | Claims are specific and quantified: numbers, tools, outcomes. Vague claims ("strong communicator") cost 1 point each up to 7. |
| JD coverage (requires JD) | 6 | Three to five of the top must-haves are covered with real evidence. Fewer than 3 covered costs half. Keyword stuffing (every must-have jammed in) costs 3. |
| Motivation | 4 | Motivation section names something specific: a product, a problem, a value. Generic enthusiasm earns 0 or 1. |

If resume is missing, redistribute the 10 evidence-alignment points: 5 to
specificity, 5 to evidence quality. If JD is missing, redistribute the 6
coverage points: 3 to specificity, 3 to motivation.

### 2. Structure (20)

| Check | Points | Pass criteria |
|-------|--------|--------------|
| Sections present | 5 | Opening hook, fit/evidence, motivation, close all identifiable |
| Opening | 5 | First sentence is specific and not on the filler-opener list. Generic opener costs all 5 points. |
| Close | 3 | Two sentences max, no "do not hesitate to contact me", plain sign-off |
| Length | 4 | Word count within target band (default 250-400, or persona band) |
| Formatting | 3 | No stray markdown headings, no bullet lists, no tables, no code blocks. Letter reads as prose. |

### 3. Voice and Humanness (25)

| Check | Points | Pass criteria |
|-------|--------|--------------|
| Burstiness | 7 | Sentence length standard deviation >= 5 words; at least one sentence under 10 words and one over 20 per paragraph |
| AI phrase count | 6 | Zero phrases from the AI phrase list below. Minus 1 per phrase, down to 0. |
| Vocabulary diversity (TTR) | 4 | Type-Token Ratio >= 0.5 for letters over 200 words. Below 0.4 earns 0. |
| Contraction/formality match | 3 | Contraction frequency within persona band (default 0.3-0.6). If no persona, accept 0.2-0.7. |
| Em-dash count | 2 | Zero em-dashes. Em-dashes are a strong AI-output signal; each one costs both points. |
| Passive voice | 3 | At most 10% of clauses in passive voice (or persona cap) |

#### AI phrase list

Flag any occurrence of these, case-insensitive. Extends the blog-analyze list
with cover-letter-specific killers:

Cover-letter specific:

1. "I am writing to express"
2. "I am writing to apply"
3. "Please accept this letter"
4. "It is with great enthusiasm"
5. "I believe I would be a great fit"
6. "I would be a valuable asset"
7. "proven track record"
8. "dynamic team"
9. "fast-paced environment"
10. "hit the ground running"
11. "team player"
12. "results-driven"
13. "detail-oriented"
14. "passionate about"
15. "excited about the opportunity"
16. "hope this message finds you well"
17. "do not hesitate to contact me"
18. "please do not hesitate"
19. "eagerly await your response"
20. "look forward to hearing from you"

Sentimental cliches (corny / Hallmark-card tells):

21. "hit close to home" / "struck close to home"
22. "struck a chord"
23. "resonated with me"
24. "spoke to me"
25. "a dream come true"
26. "right up my alley"
27. "a perfect fit"
28. "meant to be"
29. "the stars aligned"
30. "at the end of the day"
31. "wearing my heart on my sleeve"
32. "music to my ears"

General AI prose tells:

33. "It's important to note"
34. "In today's [adjective] landscape"
35. "Delve into"
36. "Navigating the complexities"
37. "Let's explore"
38. "Furthermore"
39. "In conclusion"
40. "Embark on"
41. "Cutting-edge"
42. "Leverage" (as a verb)
43. "Game-changer"
44. "Revolutionize"
45. "Streamline"
46. "Harness the power"
47. "Unlock the potential"
48. "World-class"
49. "Next-generation"
50. "Holistic approach"
51. "Spearheaded"
52. "Synergies" / "Synergize"

### 4. Correctness (20)

| Check | Points | Pass criteria |
|-------|--------|--------------|
| No fabrications (requires resume) | 8 | Every specific claim (tool, company, number, duration) traces to the resume. Any invented detail is a critical bug and costs all 8. |
| No contradictions (requires resume) | 4 | No claim contradicts the resume (wrong dates, wrong employer, wrong role). Any contradiction costs all 4. |
| Grammar and spelling | 4 | No grammatical errors, no typos. Minus 1 per error up to 4. |
| Pronoun and tense consistency | 2 | First-person consistent; past roles in past tense; current role in present tense. |
| Recipient and addressee | 2 | If hiring manager name is provided or discoverable, used correctly. If not, "Dear Hiring Team" or similar. Never "To whom it may concern" unless the JD literally says no name available. |

If resume is missing, redistribute the 12 no-fabrication/no-contradiction
points: 6 to grammar (cap), 4 to pronoun consistency, 2 to addressee.

## Burstiness, TTR, passive voice

Compute these from the letter body (exclude the date header, address block,
and sign-off).

- **Burstiness**: standard deviation of sentence lengths in words. Split on
  `.`, `!`, `?`; ignore abbreviations like "Dr.", "Mr.", "Inc.".
- **TTR**: unique words / total words, lowercased, with punctuation stripped.
  Filter filler words optional but not required.
- **Passive voice**: count clauses where the main verb is a form of "to be" +
  past participle (was written, is managed, will be built). Express as a
  percentage of total sentences.

Report each as a number in the output.

## Strict mode

With `--strict`:

- Length band tightens to 220-340 words.
- TTR threshold raises to 0.55.
- Passive voice cap drops to 7%.
- Any AI phrase is a critical issue, not a point deduction alone.
- Em-dash count is critical, not just a point deduction.

## Rating table

| Score | Rating | Action |
|-------|--------|--------|
| 90-100 | Exceptional | Send as-is |
| 80-89 | Strong | Light polish on one or two items |
| 70-79 | Acceptable | Targeted rewrite on lowest-scoring category |
| 60-69 | Weak | Rewrite recommended; see critical issues first |
| < 60 | Rewrite | Too many fundamental issues; start from the `cover-letter-write` workflow |

## Report format (default markdown)

```
## Cover Letter Audit: [filename or "pasted letter"]

**Score: [X]/100 - [Rating]**

### Category breakdown
| Category | Score | Max | Summary |
|----------|-------|-----|---------|
| Content and Fit | X | 35 | [1 line] |
| Structure | X | 20 | [1 line] |
| Voice and Humanness | X | 25 | [1 line] |
| Correctness | X | 20 | [1 line] |

### AI content signals
- Burstiness (sentence length std dev): [X] ([low/medium/high])
- AI phrases detected: [N] - [list if any]
- Vocabulary diversity (TTR): [X] ([below/at/above threshold])
- Em-dashes: [N] ([pass/fail])
- Passive voice: [X]% ([within/over cap])
- **AI probability estimate**: [Low/Medium/High] based on combined signals

### Evidence alignment
[List of claims and their resume mapping; flag any unsupported]

### JD coverage
- Must-haves present: [N/N listed]
- Keyword stuffing detected: [yes/no]

### Issues (ordered by severity)

#### Critical
- [ ] [Specific issue with location and fix]

#### High
- [ ] [...]

#### Medium
- [ ] [...]

#### Low
- [ ] [...]

### Recommended next step
[One of: "Send as-is", "Apply the Critical fixes then send",
"Run /cover-letter rewrite <file> --focus <category>", or
"Run /cover-letter write from scratch"]
```

## JSON format (--format json)

```json
{
  "file": "acme-senior-fe-2026-04-24.md",
  "score": 82,
  "rating": "Strong",
  "categories": {
    "content_fit": { "score": 29, "max": 35 },
    "structure": { "score": 18, "max": 20 },
    "voice_humanness": { "score": 20, "max": 25 },
    "correctness": { "score": 15, "max": 20 }
  },
  "signals": {
    "burstiness": 6.4,
    "ai_phrases": ["proven track record", "passionate about"],
    "ttr": 0.52,
    "em_dashes": 0,
    "passive_voice_pct": 8.1,
    "ai_probability": "low"
  },
  "issues": {
    "critical": [],
    "high": ["Opening sentence is generic"],
    "medium": ["Two AI phrases detected"],
    "low": []
  },
  "recommended_next": "rewrite --focus humanize"
}
```

## Table format (--format table)

One-liner for quick triage, useful in batch mode.

```
File                             | Score | Rating    | Content | Struct | Voice | Correct | AI signals
acme-senior-fe-2026-04-24.md     |    82 | Strong    |  29/35  |  18/20 | 20/25 | 15/20   | 2 phrases, TTR 0.52
```

## Batch mode

When pointed at a directory, audit every `.md`, `.mdx`, `.docx`, `.pdf` file
in it. Sort by score ascending (worst first). Useful for comparing several
draft letters before sending.

## How to weigh signals into "AI probability"

No single signal is decisive. Combine:

- **High risk**: burstiness under 3, TTR under 0.4, three or more AI phrases,
  any em-dashes, generic opener. Three or more of these hits = High.
- **Medium risk**: one or two of the above hits.
- **Low risk**: none or one minor.

Report High/Medium/Low, not a fake percentage.

## What this skill does not do

- Does not rewrite the letter. Route the user to `cover-letter-rewrite` after
  the audit if fixes are needed.
- Does not infer resume content from the letter. If a resume is not supplied,
  say so explicitly rather than guessing whether a claim is fabricated.
- Does not check external facts about the company (e.g., whether a named
  product actually exists). The user owns factual accuracy about the employer.
