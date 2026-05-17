export const FOCUS_IDS = ['security', 'bugs', 'performance', 'code-smells', 'architecture'] as const
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
}

function assertOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): asserts value is T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`Invalid ${field}: ${JSON.stringify(value)} (allowed: ${allowed.join(', ')})`)
  }
}

export function parseFinding(raw: unknown): ReviewFinding {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Finding must be an object, got ${typeof raw}`)
  }
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string') throw new Error('Finding.id must be string')
  if (typeof r.file !== 'string') throw new Error('Finding.file must be string')
  if (r.line !== null && typeof r.line !== 'number') {
    throw new Error('Finding.line must be number or null')
  }
  assertOneOf(r.severity, SEVERITIES, 'severity')
  if (!r.risk || typeof r.risk !== 'object') throw new Error('Finding.risk must be object')
  const risk = r.risk as Record<string, unknown>
  assertOneOf(risk.impact, IMPACTS, 'risk.impact')
  assertOneOf(risk.likelihood, LIKELIHOODS, 'risk.likelihood')
  assertOneOf(risk.confidence, CONFIDENCES, 'risk.confidence')
  assertOneOf(risk.action, ACTIONS, 'risk.action')
  if (typeof r.title !== 'string') throw new Error('Finding.title must be string')
  if (typeof r.description !== 'string') throw new Error('Finding.description must be string')

  let suggestion: Suggestion | undefined
  if (r.suggestion !== undefined && r.suggestion !== null) {
    const s = r.suggestion as Record<string, unknown>
    if (typeof s.body !== 'string') throw new Error('suggestion.body must be string')
    if (typeof s.startLine !== 'number') throw new Error('suggestion.startLine must be number')
    if (typeof s.endLine !== 'number') throw new Error('suggestion.endLine must be number')
    suggestion = { body: s.body, startLine: s.startLine, endLine: s.endLine }
  }

  return {
    id: r.id,
    file: r.file,
    line: (r.line as number | null) ?? null,
    severity: r.severity as Severity,
    risk: {
      impact: risk.impact as Impact,
      likelihood: risk.likelihood as Likelihood,
      confidence: risk.confidence as Confidence,
      action: risk.action as Action,
    },
    title: r.title,
    description: r.description,
    suggestion,
    domain: (r.domain as ReviewFinding['domain']) ?? null,
    mergedFrom: Array.isArray(r.mergedFrom) ? (r.mergedFrom as MergedFromEntry[]) : undefined,
  }
}
