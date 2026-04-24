---
name: cover-letter-write
description: >
  Generate a cover letter from a resume and a job description. Accepts resume and
  JD as PDF, DOCX, markdown/MDX, URL, or pasted text. Produces markdown, DOCX, and
  PDF outputs. Enforces human-sounding prose (varied sentence length, concrete
  verbs, no filler openers), aligns every claim to a resume bullet, and covers the
  top job-description requirements without keyword stuffing. Respects active
  writing persona if one is set via /cover-letter persona use. Use when the user
  says "write cover letter", "draft cover letter", "generate cover letter", "new
  cover letter", "cover letter for <role>", or shares a resume and job description
  together. Even if the user phrases it as "make me a cover letter" or "help me
  apply to X", trigger this skill.
argument-hint: "--resume <file> --jd <file|url|text> [--length short|standard|long] [--out <dir>]"
---

# Cover Letter Writer

Produce a cover letter that reads like a human wrote it, fits the specific job,
and only makes claims the resume actually supports.

## Inputs

Required:

- **Resume**: `.pdf`, `.docx`, `.md`, `.mdx`, or `.txt`. Passed as `--resume <path>`
  or as the first file attached to the conversation.
- **Job description**: file (same formats), URL, or pasted text. Passed as
  `--jd <path|url>` or pasted inline.

Optional:

- `--length short|standard|long` (180/300/420 words; default standard)
- `--out <dir>` (default `./cover-letters/`)
- `--tone <persona-name>` (override active persona for this run only)
- `--focus <keyword,keyword>` (emphasize specific JD themes)
- `--no-audit` (skip post-generation self-audit)

If either required input is missing, ask for it before proceeding. Do not
hallucinate resume content or JD requirements.

## Workflow

Run these steps in order. Report progress concisely after each.

### Step 1: Extract inputs

Resume parsing:

| Format | Command |
|--------|---------|
| `.md`, `.mdx`, `.txt` | Read tool, direct |
| `.pdf` | `pdftotext -layout <file> -` (poppler). Fall back to `pandoc <file> -t markdown` if not installed. |
| `.docx` | `pandoc <file> -t markdown` |

Job description parsing: same table. For URLs, use `WebFetch` and extract the
visible posting text (skip navigation, footers, "similar jobs" blocks).

If a required tool is missing, stop and report the install command
(`brew install poppler pandoc` on macOS, `apt-get install poppler-utils pandoc`
on Debian/Ubuntu).

### Step 2: Build the fact sheet

From the resume, extract:

- Full name, email, phone, location, link(s)
- Current role and company (if present)
- All past roles with dates, companies, titles
- Every bullet point, grouped by role
- Skills, tools, languages, certifications
- Education
- Quantified outcomes (numbers, percentages, revenue, users, latency wins)

From the job description, extract:

- Company name, role title, team (if given), location, work mode
- Company mission or product line (one sentence if the JD mentions it)
- Must-have requirements (usually the "Requirements" section)
- Nice-to-haves
- Responsibilities
- Tools, languages, frameworks, methodologies named
- Tone signals: does the JD read formal, casual, mission-driven, technical-deep?

Build an internal JSON scratchpad you can reason from. Do not show it to the
user unless they ask. Example shape:

```json
{
  "applicant": { "name": "...", "current_role": "...", "years": 7 },
  "jd": { "company": "...", "role": "...", "tone": "casual-technical" },
  "must_haves": ["Go", "distributed systems", "on-call"],
  "evidence_map": {
    "Go": "Payments team at Stripe, 3 years, refactored billing gateway in Go",
    "distributed systems": "Led migration of order service to event-sourced architecture",
    "on-call": null
  },
  "gaps": ["on-call"]
}
```

### Step 3: Decide fit strategy

From the evidence map, pick the top three to five matches where:

1. The requirement is explicitly in the JD (must-have preferred over nice-to-have).
2. The resume has a concrete, quantified bullet that maps to it.
3. The bullets are not redundant with each other. Prefer breadth: infra +
   leadership + product sense beats three infra bullets.

For each gap (must-have with no resume evidence), decide:

- If the gap is important and the user has shown interest in learning, include
  one honest line showing how the applicant bridges it ("I have not shipped Go
  in production, but my Rust work translates closely and I have been writing
  Go for side projects for the last six months") ONLY if the user confirmed
  this background elsewhere. Do not invent.
- If unconfirmed, flag the gap to the user and ask how to handle it.

### Step 4: Load persona

Check `~/.config/cover-letter/active-persona`. If a persona is active and the
user did not override with `--tone`, load that persona JSON.

Without a persona, use these defaults:

| Setting | Default |
|---------|---------|
| Tone dimensions | funny_serious 0.7, formal_casual 0.55, respectful_irreverent 0.2, enthusiastic_matter_of_fact 0.55 |
| Sentence length mean | 16 |
| Sentence length std dev | 8 |
| Contraction frequency | 0.4 (moderate) |
| Passive voice cap | 10% |
| Readability | Flesch grade 8-10 |

If the JD signals a clear tone (a startup posting that uses "ya'll" and
emoji wants casual; a law firm posting that uses "the Firm" and
"heretofore" wants formal), nudge the defaults one step toward that tone
unless a persona explicitly locks them.

### Step 5: Draft the letter

Produce a single draft in markdown. Structure:

```
[Date]

[Hiring Manager / Team name, if known; otherwise skip]
[Company name]

Dear [Name or "Hiring Team"],

[Opening hook - 2 sentences]

[Fit and evidence - 1 to 2 short paragraphs, 3 to 5 sentences]

[Motivation - 2 to 4 sentences]

[Close - 2 sentences + plain sign-off]

Sincerely,
[Applicant name]
```

Writing rules the draft must follow:

- **No filler openers.** Do not start with "I am writing to...", "It is with
  great enthusiasm that...", "Please accept this letter as...". Start with a
  specific observation about the role, company, or problem.
- **Evidence clause shape.** For each claim, pattern is `[specific outcome] at
  [specific context]`. Example: "Cut p99 latency on the checkout API from
  420ms to 95ms at Stripe by moving the pricing lookup into a Redis cache" not
  "Strong backend performance experience".
- **Burstiness target.** Sentence lengths should vary. At least one sentence
  under 10 words per paragraph and at least one over 20.
- **Concrete verbs.** Prefer shipped, cut, rewrote, owned, built, led, wrote,
  scaled, debugged. Avoid leveraged, utilized, spearheaded, synergized,
  orchestrated, empowered, facilitated, navigated.
- **No hollow superlatives.** Avoid "world-class", "cutting-edge",
  "game-changing", "next-generation" unless quoting the company back to itself
  from the JD (and then only once).
- **Do not repeat the resume.** The letter says what the resume cannot: why
  these bullets matter for *this* role, and why the applicant wants it.
- **One "I" density check.** Fewer than 40% of sentences should start with "I".

### Step 6: Self-audit (unless --no-audit)

Before writing files, run the audit checks inline:

1. Word count within target band (default 250-400)
2. No AI phrases from the list in `cover-letter-audit` (50+ phrases)
3. Sentence length std dev >= 5 (burstiness proxy)
4. Passive voice <= persona cap (default 10%)
5. Every claim traceable to a resume bullet
6. Top 5 JD must-haves are either covered or explicitly acknowledged as gaps
7. Company name and role appear at least once each
8. No filler opener

If any check fails, revise the draft before emitting files. Report the
revisions in one line.

### Step 7: Emit outputs

Write markdown first. Derive DOCX and PDF from it.

```bash
# from cwd or --out dir
pandoc cover-letter.md -o cover-letter.docx
pandoc cover-letter.md -o cover-letter.pdf --pdf-engine=weasyprint
```

PDF engine fallback order:

1. `weasyprint` (best typography out of the box)
2. `wkhtmltopdf`
3. `xelatex` (if a LaTeX distribution is installed)
4. Chromium headless (`google-chrome --headless --print-to-pdf=out.pdf input.html` after converting md to html with pandoc)

If no engine is available, emit only markdown and DOCX, and tell the user which
install (`brew install weasyprint` on macOS) would unlock the PDF.

### Step 8: Report

One terse summary: file paths, self-audit score, any acknowledged gaps. If the
self-audit score is below 85, suggest `/cover-letter rewrite <file> --focus
humanize` (or whichever category scored lowest).

## Handling edge cases

- **Resume has no quantified bullets.** Ask the user for one or two numbers
  (team size, users served, revenue, latency, headcount). A bulletless letter
  reads weak. If they cannot provide any, note it and write the letter with
  qualitative evidence only.
- **JD is vague.** If the JD lacks concrete requirements, shift the letter's
  weight from evidence to motivation, and lean on the company's public
  product/mission. Ask the user for a company URL if none is supplied.
- **Multiple roles apply.** If the user has several target roles, produce one
  letter per role; do not blend. Ask which one to start with.
- **Referral or recruiter.** If the user mentions a referrer by name, work
  that into the opening hook in one line, not a paragraph.
- **Career change.** Lead with motivation and transferable evidence. The gap
  acknowledgment rule applies more heavily here; do not paper over the change.

## Example: good opening vs bad opening

**Bad (filler, generic, AI-shaped):**

> I am writing to express my enthusiastic interest in the Senior Frontend
> Engineer position at Acme Corp. With over seven years of experience in the
> industry, I believe I would be a great fit for your dynamic team.

**Good (specific, grounded, human):**

> Your post on offline-first editing in the Acme blog lined up with a problem
> I spent eighteen months on at Notion: making a collaborative editor survive
> a subway commute. I'd like to work on the rest of that problem with you.

The first sentence in the good example mentions a specific company post, a
specific technical problem, a specific prior employer, and a specific duration.
The bad example says none of that. This difference is the whole point.

## Output rendering note

Cover letters should render well as PDF. Keep markdown simple: no tables, no
code blocks, no HTML. Just paragraphs, a date header, and a sign-off. Headers
and lists in a cover letter look wrong in most contexts, so avoid them unless
the user explicitly asks.
