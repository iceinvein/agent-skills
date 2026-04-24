---
name: cover-letter-persona
description: >
  Create and manage writing personas for cover letters using the NNGroup 4-dimension
  tone framework (funny-serious, formal-casual, respectful-irreverent, enthusiastic-
  matter-of-fact) adapted for professional correspondence. Personas define readability
  target, sentence length distribution, contraction frequency, passive voice cap, and
  do/don't lists. Used by cover-letter-write and cover-letter-rewrite to enforce a
  consistent voice across all applications. Use when the user says "persona",
  "voice", "tone", "writing style", "make it sound more formal", "more casual",
  "create persona", "use persona", or asks how to tune the voice of their letters.
argument-hint: "[create|list|use|show|delete] [persona-name]"
---

# Cover Letter Persona

Manage reusable voice profiles. A persona locks in tone, sentence style, and
vocabulary so every letter the user writes sounds like the same person applied.

Default (no persona active) is a mid-formal professional voice. For most
applicants that is fine; personas matter more for people applying to several
companies with different cultures, or for writers with a strong distinctive voice
(creative roles, founders, senior leaders).

## State location

Personas live at `~/.config/cover-letter/personas/<name>.json`. Active persona
is recorded at `~/.config/cover-letter/active-persona` (plain text, one line).

Create the directory on first run. Use kebab-case filenames (e.g.,
`formal-exec.json`, `casual-startup.json`, `technical-deep.json`).

## Commands

| Command | Purpose |
|---------|---------|
| `/cover-letter persona create [name]` | Interactive interview; writes a new persona file |
| `/cover-letter persona list` | Show all saved personas |
| `/cover-letter persona use <name>` | Set the active persona for this session |
| `/cover-letter persona show <name>` | Print full persona profile |
| `/cover-letter persona delete <name>` | Remove a persona file (ask to confirm) |

## Create workflow

Six steps. Ask each, wait for the answer, move on. Keep the interview short:
the whole thing should take a minute or two.

### Step 1: Basics

Ask:

- **Persona name** (kebab-case; suggest one if user gives a description)
- **Who is this for?** (one sentence: "applying to early-stage startups",
  "applying to law firms", "my default voice for senior eng roles")
- **What is the applicant's career stage?** (early, mid, senior, exec, changer)

### Step 2: Tone dimensions

Present each dimension as 0.0 to 1.0. Explain both ends with cover-letter examples.

| Dimension | 0.0 | 1.0 | 0.0 example | 1.0 example |
|-----------|-----|-----|-------------|-------------|
| funny_serious | Funny | Serious | "I've spent the last three years trying to make Postgres go fast. Mostly succeeded." | "I have spent three years leading performance initiatives in relational database systems." |
| formal_casual | Formal | Casual | "I hope this finds you well." | "Hey team," |
| respectful_irreverent | Respectful | Irreverent | "I admire your commitment to craft." | "Your stack is a mess, and that's exactly why I want the job." |
| enthusiastic_matter_of_fact | Enthusiastic | Matter-of-fact | "This role is exactly what I've been looking for!" | "This role fits the work I'm already doing." |

Defaults if the user is unsure:

| Stage | Defaults |
|-------|----------|
| Early career | 0.5, 0.5, 0.2, 0.5 |
| Mid / default | 0.7, 0.55, 0.2, 0.55 |
| Senior | 0.75, 0.45, 0.25, 0.45 |
| Exec | 0.85, 0.3, 0.15, 0.4 |
| Creative / founder | 0.5, 0.7, 0.4, 0.6 |

### Step 3: Writing rules

Ask:

| Setting | Default | Notes |
|---------|---------|-------|
| Readability band | Flesch grade 8-10 | Raise for technical roles (10-12), lower for consumer/creative (7-9) |
| Target sentence length mean | 16 words | |
| Sentence length std dev | 8 | Higher std dev = more burstiness = more human |
| Contraction frequency | 0.4 | 0.0 = never use contractions; 0.8 = use them freely |
| Passive voice cap | 10% | Only lower this if user has strong preference |

### Step 4: Do's and don'ts (short lists)

Ask for three to five items per list. Offer starters based on the tone
dimensions already chosen. These become hard rules the writer enforces.

Example do's:

- "Open with a specific observation, never a greeting about the company's mission in the abstract"
- "Name at least one product, team, or post by the company"
- "Use numbers in at least two sentences"
- "Sign off with a single-word closing"

Example don'ts:

- "Do not use 'passionate' or 'driven'"
- "Do not start sentences with 'I am'"
- "Do not mention years of experience as a standalone claim"
- "Do not use bullet points or section headings"

### Step 5: Signature block

Ask for the applicant's preferred:

- Closing word ("Sincerely", "Best", "Regards", "Thanks", or custom)
- Name format ("Alex Chen", "Alexandra Chen, PhD", etc.)
- Contact line preference (email only, email + phone, email + portfolio URL)

These go into every letter unchanged.

### Step 6: Voice sample (optional)

Ask if the user has one to three samples of writing that sounds like the
voice they want. Accept URLs, pasted text, or filepaths. For each, extract:

- Average sentence length
- Contraction frequency
- Tone dimension estimate (rough: funny/serious, formal/casual, etc.)

Compare to the persona settings and flag any large mismatches. Example:
"Your sample has sentence length mean 22, but you set the target to 14. Which
should I go with?"

## Persona file schema

```json
{
  "name": "senior-eng-default",
  "description": "Mid-to-senior engineering roles at tech companies",
  "stage": "senior",
  "tone_dimensions": {
    "funny_serious": 0.75,
    "formal_casual": 0.45,
    "respectful_irreverent": 0.25,
    "enthusiastic_matter_of_fact": 0.45
  },
  "readability": {
    "flesch_grade_min": 9,
    "flesch_grade_max": 11
  },
  "style": {
    "sentence_length_mean": 17,
    "sentence_length_std": 8,
    "contraction_frequency": 0.4,
    "passive_voice_max_pct": 10
  },
  "signature": {
    "closing": "Best",
    "name": "Alex Chen",
    "contact_line": "alex@example.com | portfolio.example.com"
  },
  "do": [
    "Open with a specific observation about the company's product or post",
    "Name at least one tool, system, or outcome",
    "Use numbers in at least two sentences"
  ],
  "dont": [
    "Do not use 'passionate' or 'driven'",
    "Do not start with 'I am writing'",
    "Do not use bullet points or section headings"
  ],
  "voice_samples": []
}
```

## List command

Glob `~/.config/cover-letter/personas/*.json` and render:

| Persona | Stage | Tone hint | Last used |
|---------|-------|-----------|-----------|
| senior-eng-default | senior | serious, mid-formal | 2026-04-20 |
| casual-startup | senior | serious, casual | 2026-04-24 |

If no personas exist, prompt to create one.

## Use command

Read the named persona JSON. Write its name to
`~/.config/cover-letter/active-persona`. Print a short confirmation:

```
Active persona: senior-eng-default
- Tone: serious (0.75), mid-formal (0.45), respectful (0.25), matter-of-fact (0.45)
- Sentence length target: 17 words ± 8
- Contractions: 40%; passive cap: 10%
- Signature: "Best,\nAlex Chen\nalex@example.com | portfolio.example.com"
```

`cover-letter-write` and `cover-letter-rewrite` read this file before
generating.

## Show command

Pretty-print the JSON with section headers and readable do/don't lists.

## Delete command

Ask the user to confirm, then remove the file. If the deleted persona was
active, also clear `~/.config/cover-letter/active-persona`.

## Error handling

- **Invalid tone values**: clamp to [0.0, 1.0] and warn.
- **Name conflict on create**: ask whether to overwrite or pick a new name.
- **Missing persona on use/show/delete**: list available personas and ask
  which one the user meant.
- **Corrupted persona file**: report the error and offer to rebuild it from
  the interview.

## When a persona is probably overkill

- Applying to one job: skip the persona, let the writer use JD-based defaults.
- First-time user: suggest they run `/cover-letter write` once with defaults,
  then decide whether they want to encode that voice.

## When a persona is worth it

- Applying to multiple jobs in the same batch.
- Applicant has a distinctive voice and existing professional content that
  proves it (blog, talks, prior letters).
- Applying across very different cultures (legal + startup) and wanting
  different personas per batch.
