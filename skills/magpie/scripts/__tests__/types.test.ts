import { describe, expect, test } from 'bun:test'
import type { FocusId, PrFileEntry, ReviewFinding } from '../types.ts'
import {
  coerceRisk,
  deriveSeverity,
  FOCUS_IDS,
  isSuggestion,
  looksLikeProse,
  parseBrief,
  parseFinding,
} from '../types.ts'

test('FOCUS_IDS contains the LLM focuses plus the deterministic tests domain', () => {
  expect(FOCUS_IDS).toEqual([
    'security',
    'bugs',
    'performance',
    'code-smells',
    'architecture',
    'tests',
  ])
})

test('parseFinding accepts a minimal finding', () => {
  const focus: FocusId = 'bugs'
  const raw = {
    id: 'f1',
    file: 'src/x.ts',
    line: 10,
    severity: 'high',
    risk: { impact: 'high', likelihood: 'possible', confidence: 'medium', action: 'should-fix' },
    title: 'oops',
    description: 'detail',
    domain: focus,
  }
  const parsed: ReviewFinding = parseFinding(raw)
  expect(parsed.title).toBe('oops')
  expect(parsed.domain).toBe('bugs')
})

const RISK_HIGH = {
  impact: 'high',
  likelihood: 'possible',
  confidence: 'medium',
  action: 'should-fix',
} as const

describe('deriveSeverity', () => {
  test('critical impact maps to blocker', () => {
    expect(deriveSeverity({ ...RISK_HIGH, impact: 'critical' })).toBe('blocker')
  })
  test('high impact maps to high', () => {
    expect(deriveSeverity({ ...RISK_HIGH, impact: 'high' })).toBe('high')
  })
  test('medium impact maps to medium', () => {
    expect(deriveSeverity({ ...RISK_HIGH, impact: 'medium' })).toBe('medium')
  })
  test('low impact maps to low', () => {
    expect(deriveSeverity({ ...RISK_HIGH, impact: 'low' })).toBe('low')
  })
})

test('parseFinding derives severity from risk impact, ignoring the input severity', () => {
  const parsed = parseFinding({
    id: 'f1',
    file: 'src/x.ts',
    line: 10,
    severity: 'low',
    risk: RISK_HIGH,
    title: 't',
    description: 'd',
    domain: 'bugs',
  })
  expect(parsed.severity).toBe('high')
})

test('parseFinding derives severity when the input has no severity', () => {
  const parsed = parseFinding({
    id: 'f1',
    file: 'src/x.ts',
    line: 10,
    risk: { ...RISK_HIGH, impact: 'critical' },
    title: 't',
    description: 'd',
    domain: 'bugs',
  })
  expect(parsed.severity).toBe('blocker')
})

describe('parseFinding evidence', () => {
  const base = {
    id: 'f1',
    file: 'src/x.ts',
    line: 10,
    risk: RISK_HIGH,
    title: 't',
    description: 'd',
    domain: 'bugs',
  }
  test('keeps a non-empty evidence string', () => {
    expect(parseFinding({ ...base, evidence: 'const x = req.body.id' }).evidence).toBe(
      'const x = req.body.id',
    )
  })
  test('omits an empty evidence string', () => {
    expect(parseFinding({ ...base, evidence: '' })).not.toHaveProperty('evidence')
  })
  test('omits non-string evidence', () => {
    expect(parseFinding({ ...base, evidence: 42 })).not.toHaveProperty('evidence')
  })
})

test('parseFinding coerces sentence-form action to canonical enum', () => {
  const parsed = parseFinding({
    id: 'f1',
    file: 'src/x.ts',
    line: 10,
    severity: 'high',
    risk: {
      impact: 'high',
      likelihood: 'possible',
      confidence: 'medium',
      action: 'Should be fixed before merge',
    },
    title: 't',
    description: 'd',
    domain: 'bugs',
  })
  expect(parsed.risk.action).toBe('should-fix')
})

test('parseFinding coerces wrong-axis likelihood values', () => {
  const parsed = parseFinding({
    id: 'f1',
    file: 'src/x.ts',
    line: 10,
    severity: 'high',
    risk: { impact: 'high', likelihood: 'high', confidence: 'medium', action: 'should-fix' },
    title: 't',
    description: 'd',
    domain: 'bugs',
  })
  expect(parsed.risk.likelihood).toBe('likely')
})

describe('coerceRisk', () => {
  test('passes through canonical risk object', () => {
    expect(
      coerceRisk({
        impact: 'critical',
        likelihood: 'likely',
        confidence: 'high',
        action: 'must-fix',
      }),
    ).toEqual({
      impact: 'critical',
      likelihood: 'likely',
      confidence: 'high',
      action: 'must-fix',
    })
  })
  test('maps action synonyms and underscore/space variants', () => {
    expect(coerceRisk({ action: 'must_fix' }).action).toBe('must-fix')
    expect(coerceRisk({ action: 'should fix' }).action).toBe('should-fix')
    expect(coerceRisk({ action: 'blocker' }).action).toBe('must-fix')
    expect(coerceRisk({ action: 'nit' }).action).toBe('optional')
    expect(coerceRisk({ action: 'recommend' }).action).toBe('should-fix')
  })
  test('extracts action from full sentences', () => {
    expect(coerceRisk({ action: 'This must be fixed immediately.' }).action).toBe('must-fix')
    expect(coerceRisk({ action: 'Should fix before merging the PR' }).action).toBe('should-fix')
    expect(coerceRisk({ action: 'Consider refactoring this' }).action).toBe('consider')
    expect(coerceRisk({ action: 'Nice to have' }).action).toBe('optional')
  })
  test('maps likelihood wrong-axis values', () => {
    expect(coerceRisk({ likelihood: 'high' }).likelihood).toBe('likely')
    expect(coerceRisk({ likelihood: 'medium' }).likelihood).toBe('possible')
    expect(coerceRisk({ likelihood: 'low' }).likelihood).toBe('edge-case')
    expect(coerceRisk({ likelihood: 'edge case' }).likelihood).toBe('edge-case')
    expect(coerceRisk({ likelihood: 'n/a' }).likelihood).toBe('unknown')
  })
  test('maps impact synonyms', () => {
    expect(coerceRisk({ impact: 'blocker' }).impact).toBe('critical')
    expect(coerceRisk({ impact: 'major' }).impact).toBe('high')
    expect(coerceRisk({ impact: 'moderate' }).impact).toBe('medium')
    expect(coerceRisk({ impact: 'minor' }).impact).toBe('low')
  })
  test('maps confidence synonyms', () => {
    expect(coerceRisk({ confidence: 'certain' }).confidence).toBe('high')
    expect(coerceRisk({ confidence: 'moderate' }).confidence).toBe('medium')
    expect(coerceRisk({ confidence: 'speculative' }).confidence).toBe('low')
  })
  test('falls back to safe defaults for garbage / missing', () => {
    expect(coerceRisk({})).toEqual({
      impact: 'medium',
      likelihood: 'unknown',
      confidence: 'medium',
      action: 'consider',
    })
    expect(coerceRisk(null)).toEqual({
      impact: 'medium',
      likelihood: 'unknown',
      confidence: 'medium',
      action: 'consider',
    })
    expect(
      coerceRisk({
        impact: 'whatever',
        likelihood: 42,
        confidence: '',
        action: 'do the thing',
      }),
    ).toEqual({
      impact: 'medium',
      likelihood: 'unknown',
      confidence: 'medium',
      action: 'consider',
    })
  })
})

test('parseFinding accepts null line', () => {
  const parsed = parseFinding({
    id: 'f1',
    file: 'src/x.ts',
    line: null,
    severity: 'low',
    risk: { impact: 'low', likelihood: 'edge-case', confidence: 'medium', action: 'consider' },
    title: 't',
    description: 'd',
    domain: 'code-smells',
  })
  expect(parsed.line).toBeNull()
})

describe('PrFileEntry', () => {
  test('shape is { path, additions, deletions }', () => {
    const f: PrFileEntry = { path: 'src/a.ts', additions: 10, deletions: 2 }
    expect(f.path).toBe('src/a.ts')
    expect(f.additions).toBe(10)
    expect(f.deletions).toBe(2)
  })
})

describe('looksLikeProse', () => {
  test('returns true for multi-sentence prose with backticks', () => {
    const body =
      'Strip the delimiter from user-controlled fields. For example, inside `getX` apply a sanitiser that neutralises the tokens.'
    expect(looksLikeProse(body)).toBe(true)
  })
  test('returns true for single-line sentence-shaped explanation', () => {
    const body =
      'Reject the literal delimiter token in any field that flows into the draft before invoking Bedrock.'
    expect(looksLikeProse(body)).toBe(true)
  })
  test('returns false for multi-line replacement code', () => {
    const body =
      'if (input.includes("<<<END>>>")) {\n  throw new Error("delimiter token not allowed")\n}'
    expect(looksLikeProse(body)).toBe(false)
  })
  test('returns false for short single-line code', () => {
    expect(looksLikeProse('return null;')).toBe(false)
    expect(looksLikeProse('const x = foo(bar);')).toBe(false)
    expect(looksLikeProse('user?.id ?? "";')).toBe(false)
  })
  test('returns false for one-line code that happens to end with a period', () => {
    // No prose connectives, just a method chain.
    expect(looksLikeProse('foo.bar.baz();')).toBe(false)
  })
  test('returns false for empty body', () => {
    expect(looksLikeProse('')).toBe(false)
    expect(looksLikeProse('   ')).toBe(false)
  })
  test('returns false for fenced code block', () => {
    const body = '```ts\nconst guarded = sanitize(input)\nreturn guarded\n```'
    expect(looksLikeProse(body)).toBe(false)
  })
})

describe('parseFinding suggestion validator', () => {
  const base = {
    id: 'f1',
    file: 'src/x.ts',
    line: 10,
    severity: 'medium',
    risk: { impact: 'medium', likelihood: 'possible', confidence: 'medium', action: 'should-fix' },
    title: 't',
    description: 'd',
    domain: 'security',
  }
  test('drops suggestion when body is prose', () => {
    const parsed = parseFinding({
      ...base,
      suggestion: {
        body: 'Strip the delimiter tokens before they enter the draft. Add a regression test to confirm.',
        startLine: 10,
        endLine: 12,
      },
    })
    expect(parsed.suggestion).toBeUndefined()
  })
  test('keeps suggestion when body is real replacement code', () => {
    const parsed = parseFinding({
      ...base,
      suggestion: {
        body: 'const guarded = sanitize(input)\nreturn guarded',
        startLine: 10,
        endLine: 11,
      },
    })
    expect(parsed.suggestion).toEqual({
      body: 'const guarded = sanitize(input)\nreturn guarded',
      startLine: 10,
      endLine: 11,
    })
  })
})

describe('isSuggestion', () => {
  const base = {
    id: '1',
    file: 'a.ts',
    line: 1,
    severity: 'low' as const,
    title: 't',
    description: 'd',
    risk: {
      impact: 'low' as const,
      likelihood: 'unknown' as const,
      confidence: 'medium' as const,
      action: 'optional' as const,
    },
    domain: 'security' as const,
  }
  test('returns true for action=optional', () => {
    expect(isSuggestion(parseFinding({ ...base }))).toBe(true)
  })
  test('returns true for action=consider', () => {
    expect(
      isSuggestion(parseFinding({ ...base, risk: { ...base.risk, action: 'consider' } })),
    ).toBe(true)
  })
  test('returns false for action=must-fix', () => {
    expect(
      isSuggestion(parseFinding({ ...base, risk: { ...base.risk, action: 'must-fix' } })),
    ).toBe(false)
  })
  test('returns false for action=should-fix', () => {
    expect(
      isSuggestion(parseFinding({ ...base, risk: { ...base.risk, action: 'should-fix' } })),
    ).toBe(false)
  })
})

test('parseBrief accepts a well-formed brief', () => {
  const brief = parseBrief({
    purpose: 'Adds retry handling to the upload path.',
    changes: ['Wraps the S3 put in a bounded retry', 'Adds a jittered backoff helper'],
    watchItems: ['The PR body claims idempotency but no request key is sent'],
    unclear: ['Whether the retry budget interacts with the outer request timeout'],
  })
  expect(brief).not.toBeNull()
  expect(brief?.purpose).toBe('Adds retry handling to the upload path.')
  expect(brief?.changes).toHaveLength(2)
  expect(brief?.watchItems).toHaveLength(1)
  expect(brief?.unclear).toHaveLength(1)
})

test('parseBrief ignores a subsystems key left in an archived brief', () => {
  const brief = parseBrief({
    purpose: 'Adds retry handling to the upload path.',
    changes: ['Wraps the S3 put in a bounded retry'],
    subsystems: [{ name: 'upload', role: 'owns the client-facing put path' }],
    watchItems: [],
    unclear: [],
  })
  expect(brief).toEqual({
    purpose: 'Adds retry handling to the upload path.',
    changes: ['Wraps the S3 put in a bounded retry'],
    watchItems: [],
    unclear: [],
    reviewRules: [],
  })
})

test('parseBrief returns null for a brief with no purpose', () => {
  expect(parseBrief({ changes: ['a'] })).toBeNull()
  expect(parseBrief({ purpose: '   ', changes: ['a'] })).toBeNull()
})

test('parseBrief returns null for non-objects', () => {
  expect(parseBrief(null)).toBeNull()
  expect(parseBrief('a brief')).toBeNull()
  expect(parseBrief(['a brief'])).toBeNull()
})

test('parseBrief drops junk entries instead of throwing', () => {
  const brief = parseBrief({
    purpose: 'Does a thing.',
    changes: ['kept', 42, null, '   ', 'also kept'],
    watchItems: 'not an array',
    unclear: undefined,
  })
  expect(brief?.changes).toEqual(['kept', 'also kept'])
  expect(brief?.watchItems).toEqual([])
  expect(brief?.unclear).toEqual([])
})

test('parseBrief keeps review rules with a non-empty rule and source', () => {
  const brief = parseBrief({
    purpose: 'Does a thing.',
    reviewRules: [{ rule: 'x', source: 'CLAUDE.md' }, { rule: '', source: 'a' }, 'bad'],
  })
  expect(brief?.reviewRules).toEqual([{ rule: 'x', source: 'CLAUDE.md' }])
})

test('parseBrief yields no review rules when the key is absent', () => {
  expect(parseBrief({ purpose: 'Does a thing.' })?.reviewRules).toEqual([])
})
