---
name: cover-letter
description: >
  Full-lifecycle cover letter suite. Generates, audits, and rewrites cover letters
  from a resume and job description. Produces markdown, DOCX, and PDF outputs.
  Optimizes for human-sounding prose, evidence alignment with the resume, and
  coverage of the job description's key requirements. Also scores letters for
  AI-generated-content risk, structure, correctness, and tone. Use when the user
  says "cover letter", "write cover letter", "draft cover letter", "audit cover
  letter", "rewrite cover letter", "optimize cover letter", "check cover letter",
  or shares a resume and job description together. Route to the right subcommand:
  write, audit, rewrite, or persona.
argument-hint: "[write|audit|rewrite|persona] [...args]"
---

# Cover Letter Suite

Four coordinated skills for producing and refining cover letters that read like
a human wrote them, fit the job, and match the resume.

## Subcommands

| Command | Purpose | Skill |
|---------|---------|-------|
| `/cover-letter write` | Generate a letter from resume + job description | `cover-letter-write` |
| `/cover-letter audit <file>` | Score a letter on content, structure, AI-ness, correctness | `cover-letter-audit` |
| `/cover-letter rewrite <file>` | Humanize and realign an existing letter | `cover-letter-rewrite` |
| `/cover-letter persona [create\|list\|use\|show]` | Manage writing voice/tone profiles | `cover-letter-persona` |

When invoked without arguments, list these subcommands and ask which one the
user wants.

## Routing

- If the user supplies a resume file and a job description (either file, URL, or
  pasted text), route to `cover-letter-write`.
- If the user asks to check, score, or review an existing letter, route to
  `cover-letter-audit`.
- If the user asks to improve, humanize, shorten, or realign an existing letter,
  route to `cover-letter-rewrite`.
- If the user asks about voice, tone, or style, route to `cover-letter-persona`.

## Shared Conventions

All four skills share the conventions below. Keep these consistent across the
suite so outputs and state are predictable.

### File I/O

Input formats supported for both resume and job description:

| Format | Extraction tool | Notes |
|--------|----------------|-------|
| `.md`, `.mdx`, `.txt` | Direct read | Use the Read tool |
| `.pdf` | `pdftotext -layout <file> -` | Falls back to `pandoc` if `pdftotext` missing |
| `.docx` | `pandoc <file> -t markdown` | Pandoc required |
| URL (job description only) | `WebFetch` | Extract the visible job posting text |
| Pasted text | Direct use | User pastes into the prompt |

Before extracting, verify the tool is available (`command -v pdftotext`, `command -v pandoc`). If a required tool is missing, tell the user the exact install command for their platform (macOS: `brew install poppler pandoc`) and stop; do not guess at content.

### Output formats

Letters are emitted as three sibling files by default:

- `<out>/<company>-<role>-<YYYY-MM-DD>.md` (canonical source)
- `<out>/<company>-<role>-<YYYY-MM-DD>.docx` (via `pandoc`)
- `<out>/<company>-<role>-<YYYY-MM-DD>.pdf` (via `pandoc` with `--pdf-engine=weasyprint` or `wkhtmltopdf`; fall back to chromium headless if neither is present)

Default output directory: `./cover-letters/`. Override with `--out <dir>`.

Company and role slugs: lowercase, dashes, ascii only. Example:
`acme-corp-senior-frontend-engineer-2026-04-24.md`.

### State directory

Personas and session state live at `~/.config/cover-letter/`:

```
~/.config/cover-letter/
├── personas/           # one JSON per persona
├── active-persona      # plain text, contains active persona name
└── last-run.json       # last write inputs (for fast rewrite/audit)
```

Create the directory on first write. Never touch anything outside it when
managing state.

### Writing principles (shared across write and rewrite)

Cover letters that read like a human wrote them share these traits. The write
and rewrite skills enforce them; the audit skill scores against them.

1. **Specific over general.** Name the company, the role, and at least one
   concrete detail about either (a product they shipped, a mission line, a
   specific responsibility from the posting). Generic letters fail.
2. **Evidence before claim.** Each claim about the applicant traces to a bullet
   or line in their resume. No fabricated experience, numbers, or tools. If a
   JD requirement is not in the resume, acknowledge the gap honestly rather
   than inventing coverage.
3. **Earned enthusiasm.** Motivation is tied to something specific ("your shift
   to offline-first editing matches a problem I hit at X"), not generic
   superlatives ("I'm so excited about this amazing opportunity").
4. **Burstiness.** Vary sentence length. Mix short punchy sentences with
   longer complex ones. AI-sounding prose has near-uniform sentence length.
5. **Plain verbs, concrete nouns.** Prefer "shipped", "cut", "owned",
   "rewrote" to "leveraged", "utilized", "spearheaded". Prefer naming the
   thing over abstracting it.
6. **No filler openers.** Avoid "I am writing to express my interest in...",
   "It is with great enthusiasm that...", "Please accept this letter as...",
   "I hope this message finds you well". Every one of these is an AI tell and
   a wasted first sentence.
7. **No sentimental cliches.** A cover letter is not a Hallmark card. Avoid
   "hit close to home", "struck a chord", "resonated with me", "spoke to me",
   "dream come true", "right up my alley", "a perfect fit", "meant to be",
   "the stars aligned", "at the end of the day", "wearing my heart on my
   sleeve". These are corny; they signal either AI prose or a writer reaching
   for warmth they have not earned with specificity. Replace with a concrete
   reason the thing connects: which paragraph of the post, which past project
   of yours, which shared problem.
8. **Human closing.** Skip "Please do not hesitate to contact me". A plain
   sign-off works better.
9. **Length.** 250 to 400 words by default. Shorter is almost always better.
   Override with `--length short|standard|long` (180/300/420 target).

### Default structure

Four compact sections, no section headings, roughly these proportions:

| Section | % of letter | Job |
|---------|------------|-----|
| Opening hook | 10-15 | Name the role + company + one specific detail that drew you in |
| Fit and evidence | 45-55 | One to three specific matches between resume and JD, each with a concrete number, tool, or outcome |
| Motivation | 15-20 | Why *this* company/team/problem, tied to something real from your background |
| Close | 10-15 | One line restating fit, one line offering next step, plain sign-off |

## Anti-patterns

Flag or refuse to produce any of these:

- **Fabricated experience.** If the resume does not support a claim, do not
  write it. Surface the gap to the user and offer to either drop the claim
  or ask them to supply supporting detail.
- **Keyword stuffing.** Do not cram every JD keyword into the letter. Select
  three to five that align with the strongest resume evidence.
- **Tone drift.** If a persona is active, enforce it. Do not slide back to
  generic professional voice.
- **Filler phrases.** See the writing principles above and the AI phrase list
  in `cover-letter-audit`.

## Session flow

A typical end-to-end flow:

1. `/cover-letter persona create` (one-time, or skip for default professional voice)
2. `/cover-letter persona use <name>` (optional)
3. `/cover-letter write --resume <resume> --jd <jd>` produces the letter plus a self-audit score
4. If score below 85 or user unhappy, `/cover-letter rewrite <file>` with optional `--focus humanize|tighten|align`
5. `/cover-letter audit <file>` for a final independent score

Each subcommand skill details its own workflow, inputs, and outputs.
