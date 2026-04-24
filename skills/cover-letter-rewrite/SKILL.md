---
name: cover-letter-rewrite
description: >
  Revise an existing cover letter by auditing it first, then applying targeted
  fixes: humanize AI-sounding prose, align claims with the resume, tighten
  structure, adjust tone to match an active persona, or improve job-description
  coverage. Preserves the applicant's voice where it's already working. Supports
  focused passes with --focus humanize|align|tighten|structure|tone. Produces
  markdown, DOCX, and PDF outputs. Use when the user says "rewrite cover letter",
  "improve cover letter", "humanize cover letter", "fix cover letter", "tighten
  cover letter", "this cover letter sounds AI", "make this less generic", "make
  this more specific", or shares a letter and asks for edits.
argument-hint: "<letter-file> [--resume <file>] [--jd <file|url|text>] [--focus humanize|align|tighten|structure|tone] [--length short|standard|long] [--out <dir>]"
---

# Cover Letter Rewrite

Revise an existing cover letter instead of starting over. The rewrite is
audit-driven: run the audit first, then apply a minimum-change rewrite
targeting the weakest category (or the user's --focus).

## When to use rewrite vs write

- **Rewrite**: user has a draft they like the bones of. Keep their voice,
  fix specific issues.
- **Write**: user has resume + JD and nothing else, or the existing letter is
  so generic it would be easier to start fresh (audit score below 50 with
  multiple critical issues).

If the user asks to "improve" or "fix" a letter, default to rewrite. If the
letter scores below 50 with fabrication or complete topic drift, suggest a
fresh `/cover-letter write` instead.

## Inputs

Required:

- **Letter**: file path (`.md`, `.mdx`, `.docx`, `.pdf`) or pasted text.

Optional (but enable key checks):

- **Resume** (`--resume <file>`): enables evidence-alignment fixes.
- **Job description** (`--jd <file|url|text>`): enables coverage fixes.

Flags:

- `--focus <category>`: narrow the rewrite. See "Focus modes" below.
- `--length short|standard|long` (180/300/420 target).
- `--tone <persona-name>`: apply a persona for this run only.
- `--out <dir>` (default `./cover-letters/`).
- `--preserve-voice` (stricter; forbid changes outside the flagged issues).
- `--diff` (emit a unified diff between original and rewrite alongside files).

If resume or JD is missing and would be needed for the requested focus,
either ask for it or proceed with a caveat (for example, `--focus humanize`
does not need the resume, but `--focus align` does).

## Workflow

### Step 1: Parse inputs

Extract the letter using the same tools as `cover-letter-write`
(`pdftotext`, `pandoc`, direct read). Normalize to markdown for editing.

### Step 2: Run the audit

Invoke the audit rubric from `cover-letter-audit` on the letter plus optional
resume and JD. Capture:

- Overall score and category scores
- Specific issues at each severity level
- AI signals (burstiness, phrase list hits, TTR, em-dash count, passive %)
- Evidence alignment gaps
- JD coverage gaps

Do not print the full audit report unless `--show-audit` is passed. A one-line
score summary is enough.

### Step 3: Pick the rewrite plan

Without `--focus`, pick the lowest-scoring category as the primary focus and
apply light fixes to the others. With `--focus`, restrict most changes to that
category.

Rewrite plan is a short internal list: "change X here, replace Y there, add
sentence about Z". Keep it concrete. Prefer minimal edits.

### Step 4: Apply the rewrite

Edit the letter. Rules:

1. **Preserve sentences that work.** If a sentence is specific, grounded, and
   not on the AI phrase list, leave it alone.
2. **Targeted replacements.** Rewrite only the sentences or paragraphs that
   triggered the audit issues.
3. **Do not add facts.** If the audit flagged missing JD coverage and the
   resume has evidence for it, add a clause referencing that evidence. If the
   resume does not have evidence, do not invent any; surface the gap to the
   user instead.
4. **Respect active persona.** Load `~/.config/cover-letter/active-persona`
   and enforce its rules during the rewrite. The `--preserve-voice` flag
   tightens this: changes outside flagged issues are forbidden.
5. **Length.** Keep the rewritten letter within the target band. If the
   original was over length, the rewrite should cut. If under, it should add
   only where evidence supports it.

### Step 5: Post-rewrite audit

Re-run the audit on the new letter. Compare scores. If the rewrite scored
lower than the original in any category (should be rare), revert to the
original for that section or ask the user to review the regression.

### Step 6: Emit outputs

Write markdown first; then derive DOCX and PDF via pandoc (same engine
fallback order as `cover-letter-write`).

If `--diff` is set, also write a unified diff at
`<out>/<slug>-rewrite.diff`.

### Step 7: Report

One terse summary:

```
Rewrite complete.
- Files: acme-senior-fe-2026-04-24.md, .docx, .pdf
- Score: 72 -> 87 (+15)
- Focus: humanize
- Changes:
  - Replaced generic opener with specific hook about the offline-first blog post
  - Cut 3 AI phrases ("proven track record", "passionate about", "team player")
  - Raised burstiness by adding one short sentence per paragraph
  - Tightened close from 4 sentences to 2
```

## Focus modes

Each mode targets one category. The writer still performs a cleanup pass on
the others, but most edits concentrate in the focus area.

### humanize

Goal: raise the Voice and Humanness category score.

Actions:

- Replace every AI phrase hit with plain language. "Proven track record of
  delivering results" becomes "Shipped three products to production in the
  last two years" (or similar; use real resume content).
- Remove em-dashes; replace with period or comma or parentheses.
- Add burstiness: introduce at least one short sentence (under 10 words) per
  paragraph, and ensure at least one long sentence (over 20 words) per letter.
- Raise TTR: replace repeated nouns and verbs with synonyms the applicant
  would actually use.
- Cut hedging and throat-clearing ("I would like to", "I believe", "it is
  fair to say", "arguably").

### align

Goal: raise Content and Fit + Correctness by matching claims to resume.

Actions:

- For each unsupported claim, either replace it with a supported one from the
  resume or cut it.
- For each JD must-have not covered, add one clause referencing real resume
  evidence. If no evidence exists, surface the gap to the user.
- Remove vague claims ("strong backend skills") and replace with specifics
  ("five years Go, two years Rust, shipped the payments gateway at Stripe").

### tighten

Goal: raise Structure + cut word count.

Actions:

- Cut redundant sentences.
- Merge paragraphs if they cover the same subject.
- Tighten wordy phrases ("in order to" becomes "to"; "due to the fact that"
  becomes "because").
- Bring to length target.
- Remove filler sign-off lines.

### structure

Goal: raise Structure.

Actions:

- Reorder sections if motivation appears before evidence (put evidence
  second; motivation usually lands better after the fit is established).
- Rebuild opening if it is a generic greeting or filler opener.
- Rewrite close to two sentences with a concrete next step, not "I hope to
  hear from you soon".

### tone

Goal: match the active persona (or --tone override).

Actions:

- Adjust contraction frequency up or down per persona.
- Adjust sentence length distribution toward the persona's mean/std.
- Apply persona's do/don't rules.
- Swap vocabulary tier (consumer vs professional vs technical) to match.

## Examples

### humanize focus

**Before (AI-sounding):**

> Dear Hiring Manager,
>
> I am writing to express my strong interest in the Senior Frontend Engineer
> position at Acme Corp. With a proven track record of delivering cutting-edge
> solutions in dynamic environments, I am passionate about joining your
> world-class team and believe I would be a valuable asset.

**After (humanized):**

> Dear Hiring Team,
>
> Your post on offline-first editing in the Acme blog lined up with a problem
> I spent eighteen months on at Notion: making a collaborative editor survive
> a subway commute. I'd like to work on the rest of that problem with you.

### align focus

The JD lists "experience with Kafka" as a must-have. The original letter
doesn't mention it. The resume lists "migrated order service to Kafka-backed
event sourcing (2M events/day)". Rewrite adds a single clause:

**Before:**

> I have extensive backend experience and enjoy working on distributed
> systems.

**After:**

> I spent a year moving our order service to Kafka-backed event sourcing at
> Shopify; it now handles two million events a day.

### tighten focus

**Before (340 words, 4 paragraphs):**

> [Original letter with redundancy and filler]

**After (265 words, 3 paragraphs):**

> [Same content, cut to essentials, merged redundant paragraphs]

## Handling critical issues

If the audit finds a critical issue (fabrication, contradiction with resume,
or factual error about the company), do not auto-rewrite that section. Report
it to the user and ask how to resolve it:

```
Critical issue: the letter claims "five years at Stripe" but the resume shows
two years at Stripe (2022-2024). Options:
1. Change the letter to match the resume (recommended)
2. Change the resume (if the letter is correct)
3. Drop the claim

Which do you want?
```

Wait for the user's answer before completing the rewrite.

## Preserve voice mode

With `--preserve-voice`, the rewrite must not:

- Change sentence structure outside flagged issues
- Change vocabulary choices outside the AI phrase list
- Reorder sections
- Adjust tone dimensions

It may only:

- Replace flagged AI phrases with plain substitutes
- Fix fabrications and contradictions
- Add clauses for uncovered JD must-haves (if resume supports them)
- Correct grammar and spelling

Use this mode for letters the user mostly likes but where one or two specific
problems need fixing.

## What this skill does not do

- Does not write a letter from scratch. Route to `cover-letter-write` if the
  existing letter is too generic to save.
- Does not score the letter without applying changes. Route to
  `cover-letter-audit` for pure scoring.
- Does not manage personas. Route to `cover-letter-persona`.
