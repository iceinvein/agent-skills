export const FOCUS_IDS = [
  'security',
  'bugs',
  'performance',
  'code-smells',
  'architecture',
  'tests',
] as const
export type FocusId = (typeof FOCUS_IDS)[number]

export const SEVERITIES = ['blocker', 'high', 'medium', 'low'] as const
export type Severity = (typeof SEVERITIES)[number]

export const IMPACTS = ['critical', 'high', 'medium', 'low'] as const
export type Impact = (typeof IMPACTS)[number]

export const LIKELIHOODS = ['likely', 'possible', 'edge-case', 'unknown'] as const
export type Likelihood = (typeof LIKELIHOODS)[number]

export const CONFIDENCES = ['high', 'medium', 'low'] as const
export type Confidence = (typeof CONFIDENCES)[number]

export const ACTIONS = ['must-fix', 'should-fix', 'consider', 'optional'] as const
export type Action = (typeof ACTIONS)[number]

export type Risk = {
  impact: Impact
  likelihood: Likelihood
  confidence: Confidence
  action: Action
}

export type Suggestion = {
  body: string
  startLine: number
  endLine: number
}

export type MergedFromEntry = {
  domain: string
  title: string
}

export type ReviewFinding = {
  id: string
  file: string
  line: number | null
  severity: Severity
  risk: Risk
  title: string
  description: string
  suggestion?: Suggestion
  domain: FocusId | string | null
  mergedFrom?: MergedFromEntry[]
  /** Derived 0-10 importance score from risk fields. Populated during dedupe. */
  score?: number
  /**
   * Whether the anchor sits on a line this PR changed. Populated during dedupe
   * from the diff; `null` when not anchorable or the diff is unavailable.
   */
  onChangedLine?: boolean | null
}

const SEVERITY_SYNONYMS: Record<string, Severity> = {
  blocker: 'blocker',
  high: 'high',
  medium: 'medium',
  low: 'low',
  critical: 'blocker',
  severe: 'blocker',
  catastrophic: 'blocker',
  fatal: 'blocker',
  major: 'high',
  significant: 'high',
  moderate: 'medium',
  mid: 'medium',
  minor: 'low',
  trivial: 'low',
  negligible: 'low',
  info: 'low',
  informational: 'low',
}

const IMPACT_SYNONYMS: Record<string, Impact> = {
  critical: 'critical',
  high: 'high',
  medium: 'medium',
  low: 'low',
  blocker: 'critical',
  severe: 'critical',
  catastrophic: 'critical',
  fatal: 'critical',
  major: 'high',
  significant: 'high',
  moderate: 'medium',
  mid: 'medium',
  minor: 'low',
  trivial: 'low',
  negligible: 'low',
}

const LIKELIHOOD_SYNONYMS: Record<string, Likelihood> = {
  likely: 'likely',
  possible: 'possible',
  'edge-case': 'edge-case',
  unknown: 'unknown',
  'edge case': 'edge-case',
  edge_case: 'edge-case',
  edgecase: 'edge-case',
  certain: 'likely',
  probable: 'likely',
  high: 'likely',
  frequent: 'likely',
  often: 'likely',
  common: 'likely',
  medium: 'possible',
  moderate: 'possible',
  occasional: 'possible',
  sometimes: 'possible',
  rare: 'edge-case',
  unlikely: 'edge-case',
  low: 'edge-case',
  improbable: 'edge-case',
  'n/a': 'unknown',
  na: 'unknown',
  unclear: 'unknown',
  uncertain: 'unknown',
}

const CONFIDENCE_SYNONYMS: Record<string, Confidence> = {
  high: 'high',
  medium: 'medium',
  low: 'low',
  'very high': 'high',
  'very-high': 'high',
  confident: 'high',
  certain: 'high',
  strong: 'high',
  moderate: 'medium',
  mid: 'medium',
  weak: 'low',
  uncertain: 'low',
  unsure: 'low',
  speculative: 'low',
}

const ACTION_SYNONYMS: Record<string, Action> = {
  'must-fix': 'must-fix',
  'should-fix': 'should-fix',
  consider: 'consider',
  optional: 'optional',
  must_fix: 'must-fix',
  'must fix': 'must-fix',
  mustfix: 'must-fix',
  should_fix: 'should-fix',
  'should fix': 'should-fix',
  shouldfix: 'should-fix',
  block: 'must-fix',
  blocker: 'must-fix',
  blocking: 'must-fix',
  required: 'must-fix',
  critical: 'must-fix',
  fix: 'should-fix',
  recommended: 'should-fix',
  recommend: 'should-fix',
  suggestion: 'consider',
  suggest: 'consider',
  consideration: 'consider',
  improve: 'consider',
  nit: 'optional',
  'nice-to-have': 'optional',
  'nice to have': 'optional',
  maybe: 'optional',
}

const SEVERITY_KEYWORDS: ReadonlyArray<readonly [RegExp, Severity]> = [
  [/\b(block(?:er|ing)?|critical|severe|catastrophic|fatal)\b/, 'blocker'],
  [/\b(high|major|significant)\b/, 'high'],
  [/\b(medium|moderate|mid)\b/, 'medium'],
  [/\b(low|minor|trivial|negligible|info(?:rmational)?)\b/, 'low'],
]

const IMPACT_KEYWORDS: ReadonlyArray<readonly [RegExp, Impact]> = [
  [/\b(critical|blocker|severe|catastrophic|fatal)\b/, 'critical'],
  [/\b(high|major|significant)\b/, 'high'],
  [/\b(medium|moderate|mid)\b/, 'medium'],
  [/\b(low|minor|trivial|negligible)\b/, 'low'],
]

const LIKELIHOOD_KEYWORDS: ReadonlyArray<readonly [RegExp, Likelihood]> = [
  [/\b(likely|certain|probable|frequent|often|common)\b/, 'likely'],
  [/\b(possible|sometimes|occasional|moderate)\b/, 'possible'],
  [/\b(edge[- _]?case|rare|unlikely|improbable)\b/, 'edge-case'],
  [/\b(unknown|unclear|uncertain|n\/a)\b/, 'unknown'],
]

const ACTION_KEYWORDS: ReadonlyArray<readonly [RegExp, Action]> = [
  [
    /\b(must[- _]?fix|must be fixed|required|critical|block(?:er|ing)?|fix immediately|fix now)\b/,
    'must-fix',
  ],
  [
    /\b(should[- _]?fix|should be fixed|recommend(?:ed)?|fix before merge|address before merge)\b/,
    'should-fix',
  ],
  [/\b(nit|optional|nice to have|may)\b/, 'optional'],
  [/\b(consider|suggest(?:ion)?|improvement|polish)\b/, 'consider'],
]

function normalizeKey(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return value.trim().toLowerCase()
}

function coerceField<T extends string>(
  value: unknown,
  table: Record<string, T>,
  keywords: ReadonlyArray<readonly [RegExp, T]> | null,
  fallback: T,
): T {
  const key = normalizeKey(value)
  if (key === null || key === '') return fallback
  const direct = table[key]
  if (direct) return direct
  const cleaned = key.replace(/[^a-z0-9 _-]/g, '').trim()
  if (cleaned && cleaned !== key) {
    const cleanedHit = table[cleaned]
    if (cleanedHit) return cleanedHit
  }
  if (keywords) {
    for (const [pattern, mapped] of keywords) {
      if (pattern.test(key)) return mapped
    }
  }
  return fallback
}

export function coerceSeverity(value: unknown): Severity {
  return coerceField(value, SEVERITY_SYNONYMS, SEVERITY_KEYWORDS, 'medium')
}

export function coerceRisk(raw: unknown): Risk {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    impact: coerceField(r.impact, IMPACT_SYNONYMS, IMPACT_KEYWORDS, 'medium'),
    likelihood: coerceField(r.likelihood, LIKELIHOOD_SYNONYMS, LIKELIHOOD_KEYWORDS, 'unknown'),
    confidence: coerceField(r.confidence, CONFIDENCE_SYNONYMS, null, 'medium'),
    action: coerceField(r.action, ACTION_SYNONYMS, ACTION_KEYWORDS, 'consider'),
  }
}

/**
 * Detect when a `suggestion.body` string is prose ("Strip the delimiter and add
 * a regression test.") instead of literal replacement source code. Prose bodies
 * get fenced as ```suggestion on GitHub, which means clicking "Apply" would
 * commit the sentence verbatim into the file. We drop these before they reach
 * the renderer or the poster.
 *
 * Conservative: only flags clearly prose-shaped strings. Returns false for
 * empty bodies and for anything ambiguous (let real code through).
 */
export function looksLikeProse(body: string): boolean {
  const trimmed = body.trim()
  if (!trimmed) return false
  // Multi-sentence: "foo. Bar..." anywhere is unambiguous prose.
  if (/[a-z]\.\s+[A-Z]/.test(trimmed)) return true
  // Single-line, sentence-shaped (ends in period, has English connectives,
  // long enough that short code like `return null.` won't false-positive).
  if (!trimmed.includes('\n')) {
    const endsInPeriod = /[a-z)\]`'"]\.$/i.test(trimmed)
    const hasConnectives =
      /(?:^|\s)(?:the|a|an|to|in|for|and|or|that|with|on|by|should|would)\s/i.test(trimmed)
    if (endsInPeriod && hasConnectives && trimmed.length > 60) return true
  }
  return false
}

export function parseFinding(raw: unknown): ReviewFinding {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Finding must be an object, got ${typeof raw}`)
  }
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string') throw new Error('Finding.id must be string')
  if (typeof r.file !== 'string') throw new Error('Finding.file must be string')
  if (r.line !== null && typeof r.line !== 'number' && r.line !== undefined) {
    throw new Error('Finding.line must be number or null')
  }
  if (typeof r.title !== 'string') throw new Error('Finding.title must be string')
  if (typeof r.description !== 'string') throw new Error('Finding.description must be string')

  let suggestion: Suggestion | undefined
  if (r.suggestion !== undefined && r.suggestion !== null) {
    const s = r.suggestion as Record<string, unknown>
    if (typeof s.body !== 'string') throw new Error('suggestion.body must be string')
    if (typeof s.startLine !== 'number') throw new Error('suggestion.startLine must be number')
    if (typeof s.endLine !== 'number') throw new Error('suggestion.endLine must be number')
    // Drop prose bodies. They'd render as a non-applicable suggestion block and,
    // worse, GitHub's "Apply" would commit the prose verbatim into the file.
    // The fix prose already lives in `description` under `Suggested direction:`.
    if (!looksLikeProse(s.body)) {
      suggestion = { body: s.body, startLine: s.startLine, endLine: s.endLine }
    }
  }

  return {
    id: r.id,
    file: r.file,
    line: (r.line as number | null) ?? null,
    severity: coerceSeverity(r.severity),
    risk: coerceRisk(r.risk),
    title: r.title,
    description: r.description,
    suggestion,
    domain: (r.domain as ReviewFinding['domain']) ?? null,
    mergedFrom: Array.isArray(r.mergedFrom) ? (r.mergedFrom as MergedFromEntry[]) : undefined,
    ...(typeof r.score === 'number' && Number.isFinite(r.score) ? { score: r.score } : {}),
    ...(typeof r.onChangedLine === 'boolean' || r.onChangedLine === null
      ? { onChangedLine: r.onChangedLine as boolean | null }
      : {}),
  }
}

export type PostStatusEntry = 'posted' | { status: 'failed'; message: string }
export type PostStatusMap = Record<string, PostStatusEntry>

export type PrFileEntry = {
  path: string
  additions: number
  deletions: number
}

export function isSuggestion(f: ReviewFinding): boolean {
  return f.risk.action === 'consider' || f.risk.action === 'optional'
}

export type BriefSubsystem = {
  name: string
  role: string
}

/** Scout-produced PR summary. Written to `$RUN_DIR/brief.json` by the context stage. */
export type PrBrief = {
  purpose: string
  changes: string[]
  subsystems: BriefSubsystem[]
  watchItems: string[]
  unclear: string[]
}

function briefStrings(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
}

/**
 * Lenient by design, unlike `parseFinding`. A subagent-authored brief that came
 * back malformed must degrade the report header to absent, not throw away an
 * otherwise-complete review at render time.
 */
export function parseBrief(raw: unknown): PrBrief | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const purpose = typeof r.purpose === 'string' ? r.purpose.trim() : ''
  if (purpose.length === 0) return null
  const subsystems: BriefSubsystem[] = Array.isArray(r.subsystems)
    ? (r.subsystems as unknown[]).flatMap((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
        const e = entry as Record<string, unknown>
        const name = typeof e.name === 'string' ? e.name.trim() : ''
        if (name.length === 0) return []
        return [{ name, role: typeof e.role === 'string' ? e.role.trim() : '' }]
      })
    : []
  return {
    purpose,
    changes: briefStrings(r.changes),
    subsystems,
    watchItems: briefStrings(r.watchItems),
    unclear: briefStrings(r.unclear),
  }
}
