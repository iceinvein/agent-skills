import { expect, test } from 'bun:test'
import { applyCriticVerdicts, buildCriticPrompts, type CriticVerdict } from '../critic.ts'
import type { ReviewFinding, Risk } from '../types.ts'

const MEDIUM_RISK: Risk = {
  impact: 'medium',
  likelihood: 'possible',
  confidence: 'medium',
  action: 'should-fix',
}

function finding(
  id: string,
  domain: string,
  overrides: Partial<ReviewFinding> = {},
): ReviewFinding {
  return {
    id,
    file: 'src/a.ts',
    line: 10,
    severity: 'medium',
    risk: MEDIUM_RISK,
    title: `title ${id}`,
    description: `description ${id}`,
    domain,
    ...overrides,
  }
}

function keep(id: string, risk: Risk, checked: string[] = ['src/a.ts:10']): CriticVerdict {
  return { id, verdict: 'keep', reason: 'real', risk, checked }
}

test('keep applies the critic risk and derives severity from its impact', () => {
  const risk: Risk = {
    impact: 'critical',
    likelihood: 'likely',
    confidence: 'high',
    action: 'must-fix',
  }
  const result = applyCriticVerdicts({
    candidates: [finding('a', 'bugs')],
    verdicts: [keep('a', risk)],
    designCap: 3,
  })
  expect(result.kept).toHaveLength(1)
  expect(result.kept[0]?.risk).toEqual(risk)
  expect(result.kept[0]?.severity).toBe('blocker')
  // 10*0.4 + 10*0.25 + 10*0.2 + 10*0.15
  expect(result.kept[0]?.score).toBe(10)
})

test('high confidence with nothing checked is lowered to medium', () => {
  const risk: Risk = {
    impact: 'high',
    likelihood: 'likely',
    confidence: 'high',
    action: 'must-fix',
  }
  const result = applyCriticVerdicts({
    candidates: [finding('a', 'bugs')],
    verdicts: [keep('a', risk, [])],
    designCap: 3,
  })
  expect(result.kept[0]?.risk.confidence).toBe('medium')
})

test('drop verdict lands in dropped with its reason', () => {
  const result = applyCriticVerdicts({
    candidates: [finding('a', 'bugs')],
    verdicts: [{ id: 'a', verdict: 'drop', reason: 'guarded on line 4', checked: ['src/a.ts:4'] }],
    designCap: 3,
  })
  expect(result.kept).toEqual([])
  expect(result.dropped).toEqual([{ id: 'a', reason: 'guarded on line 4' }])
})

test('merge appends the source to the target mergedFrom and removes the source', () => {
  const result = applyCriticVerdicts({
    candidates: [finding('a', 'bugs'), finding('b', 'security', { title: 'unchecked input' })],
    verdicts: [
      keep('a', MEDIUM_RISK),
      { id: 'b', verdict: 'merge', reason: 'same root cause', mergeInto: 'a', checked: [] },
    ],
    designCap: 3,
  })
  expect(result.kept.map((f) => f.id)).toEqual(['a'])
  expect(result.kept[0]?.mergedFrom).toEqual([{ domain: 'security', title: 'unchecked input' }])
  expect(result.merged).toBe(1)
})

test('design-domain keeps beyond the cap drop lowest-scoring first with reason design-cap', () => {
  // Scores 7.1, 6.5, 6.0, 5.5, 5.0 from impact*0.4 + likelihood*0.25 + confidence*0.2 + action*0.15.
  const risks: Record<string, Risk> = {
    s71: { impact: 'critical', likelihood: 'possible', confidence: 'medium', action: 'consider' },
    s65: { impact: 'critical', likelihood: 'possible', confidence: 'low', action: 'consider' },
    s60: { impact: 'medium', likelihood: 'likely', confidence: 'low', action: 'must-fix' },
    s55: { impact: 'low', likelihood: 'likely', confidence: 'high', action: 'consider' },
    s50: { impact: 'medium', likelihood: 'possible', confidence: 'low', action: 'must-fix' },
  }
  const ids = ['s55', 's71', 's50', 's60', 's65']
  const result = applyCriticVerdicts({
    candidates: ids.map((id, i) => finding(id, i % 2 === 0 ? 'code-smells' : 'architecture')),
    verdicts: ids.map((id) => keep(id, risks[id] as Risk)),
    designCap: 3,
  })
  expect(result.kept.map((f) => f.score)).toEqual([7.1, 6, 6.5])
  expect(result.kept.map((f) => f.id)).toEqual(['s71', 's60', 's65'])
  expect(result.dropped).toEqual([
    { id: 's55', reason: 'design-cap' },
    { id: 's50', reason: 'design-cap' },
  ])
  expect(result.capped).toBe(2)
})

test('a capped design finding lists the findings merged into it as dropped too', () => {
  const result = applyCriticVerdicts({
    candidates: [finding('a', 'code-smells'), finding('b', 'bugs'), finding('c', 'architecture')],
    verdicts: [
      keep('a', MEDIUM_RISK),
      { id: 'b', verdict: 'merge', reason: 'same smell', mergeInto: 'a', checked: [] },
      { id: 'c', verdict: 'merge', reason: 'same smell', mergeInto: 'a', checked: [] },
    ],
    designCap: 0,
  })
  expect(result.kept).toEqual([])
  expect(result.dropped).toEqual([
    { id: 'a', reason: 'design-cap' },
    { id: 'b', reason: 'design-cap (merged into a)' },
    { id: 'c', reason: 'design-cap (merged into a)' },
  ])
})

test('bugs findings are never capped', () => {
  const ids = ['a', 'b', 'c', 'd', 'e']
  const result = applyCriticVerdicts({
    candidates: ids.map((id) => finding(id, 'bugs')),
    verdicts: ids.map((id) => keep(id, MEDIUM_RISK)),
    designCap: 3,
  })
  expect(result.kept.map((f) => f.id)).toEqual(ids)
  expect(result.capped).toBe(0)
})

test('throws naming a candidate that has no verdict', () => {
  expect(() =>
    applyCriticVerdicts({
      candidates: [finding('a', 'bugs'), finding('orphan', 'bugs')],
      verdicts: [keep('a', MEDIUM_RISK)],
      designCap: 3,
    }),
  ).toThrow(/orphan/)
})

test('throws naming a verdict for an unknown id', () => {
  expect(() =>
    applyCriticVerdicts({
      candidates: [finding('a', 'bugs')],
      verdicts: [keep('a', MEDIUM_RISK), keep('ghost', MEDIUM_RISK)],
      designCap: 3,
    }),
  ).toThrow(/ghost/)
})

test('throws naming an id with two verdicts', () => {
  expect(() =>
    applyCriticVerdicts({
      candidates: [finding('twice', 'bugs')],
      verdicts: [keep('twice', MEDIUM_RISK), keep('twice', MEDIUM_RISK)],
      designCap: 3,
    }),
  ).toThrow(/twice/)
})

test('throws naming a keep verdict whose risk is missing or has an invalid value', () => {
  const badRisk = { ...MEDIUM_RISK, impact: 'enormous' } as unknown as Risk
  let message = ''
  try {
    applyCriticVerdicts({
      candidates: [finding('norisk', 'bugs'), finding('badrisk', 'bugs')],
      verdicts: [
        { id: 'norisk', verdict: 'keep', reason: 'r', checked: [] },
        keep('badrisk', badRisk),
      ],
      designCap: 3,
    })
  } catch (err) {
    message = (err as Error).message
  }
  expect(message).toContain('norisk')
  expect(message).toContain('badrisk')
})

test('throws naming a merge with no target and a merge whose target is not kept', () => {
  let message = ''
  try {
    applyCriticVerdicts({
      candidates: [finding('a', 'bugs'), finding('notarget', 'bugs'), finding('todropped', 'bugs')],
      verdicts: [
        { id: 'a', verdict: 'drop', reason: 'r', checked: [] },
        { id: 'notarget', verdict: 'merge', reason: 'r', checked: [] },
        { id: 'todropped', verdict: 'merge', reason: 'r', mergeInto: 'a', checked: [] },
      ],
      designCap: 3,
    })
  } catch (err) {
    message = (err as Error).message
  }
  expect(message).toContain('notarget')
  expect(message).toContain('todropped')
})

const ALL_PLACEHOLDERS = [
  'C=<<CANDIDATES>>',
  'M=<<MERGE_CANDIDATES>>',
  'R=<<REVIEW_RULES>>',
  'W=<<WORKTREE>>',
  'D=<<DIFF_PATH>>',
  'O=<<OUTPUT_PATH>>',
].join('\n')

function candidates(n: number): ReviewFinding[] {
  return Array.from({ length: n }, (_, i) => finding(`c${i + 1}`, 'bugs'))
}

/** Pull the JSON value a placeholder line expanded to back out of a prompt. */
function section(prompt: string, key: string, next: string): unknown {
  const start = prompt.indexOf(`${key}=`) + key.length + 1
  const end = prompt.indexOf(`\n${next}=`)
  return JSON.parse(prompt.slice(start, end))
}

test('three candidates yield one prompt with every placeholder replaced and critic.json output', () => {
  const prompts = buildCriticPrompts({
    template: ALL_PLACEHOLDERS,
    candidates: [
      finding('c1', 'bugs', { evidence: 'const x = y', onChangedLine: true }),
      finding('c2', 'security'),
      finding('c3', 'bugs'),
    ],
    mergeCandidates: [['c1', 'c2']],
    reviewRules: [{ rule: 'no default exports', source: 'CLAUDE.md' }],
    worktree: '/run/worktree',
    diffPath: '/run/diff.patch',
    runDir: '/run',
    batchSize: 30,
  })
  expect(prompts).toHaveLength(1)
  const only = prompts[0]
  if (!only) throw new Error('no prompt')
  expect(only.outputPath).toBe('/run/critic.json')
  expect(only.prompt).not.toContain('<<')
  const rendered = section(only.prompt, 'C', 'M') as Array<Record<string, unknown>>
  expect(rendered.map((c) => c.id)).toEqual(['c1', 'c2', 'c3'])
  expect(rendered[0]).toEqual({
    id: 'c1',
    file: 'src/a.ts',
    line: 10,
    onChangedLine: true,
    risk: MEDIUM_RISK,
    domain: 'bugs',
    title: 'title c1',
    description: 'description c1',
    evidence: 'const x = y',
  })
  expect(section(only.prompt, 'M', 'R')).toEqual([['c1', 'c2']])
  expect(only.prompt).toContain('R=- no default exports (CLAUDE.md)\n')
  expect(only.prompt).toContain('W=/run/worktree\n')
  expect(only.prompt).toContain('D=/run/diff.patch\n')
  expect(only.prompt.endsWith('O=/run/critic.json')).toBe(true)
})

test('sixty-five candidates at batch size thirty yield three numbered prompts', () => {
  const prompts = buildCriticPrompts({
    template: ALL_PLACEHOLDERS,
    candidates: candidates(65),
    mergeCandidates: [],
    reviewRules: [],
    worktree: '/run/worktree',
    diffPath: '/run/diff.patch',
    runDir: '/run',
    batchSize: 30,
  })
  expect(prompts.map((p) => p.outputPath)).toEqual([
    '/run/critic-1.json',
    '/run/critic-2.json',
    '/run/critic-3.json',
  ])
  expect(prompts.map((p) => p.batch)).toEqual([1, 2, 3])
  expect(prompts.map((p) => (section(p.prompt, 'C', 'M') as unknown[]).length)).toEqual([30, 30, 5])
  expect(prompts[0]?.prompt).toContain('M=[]\n')
  expect(prompts[0]?.prompt).toContain('R=(none)\n')
})

test('a merge group straddling a batch boundary is placed whole in the batch of its first member', () => {
  const prompts = buildCriticPrompts({
    template: ALL_PLACEHOLDERS,
    candidates: candidates(35),
    mergeCandidates: [['c30', 'c31']],
    reviewRules: [],
    worktree: '/run/worktree',
    diffPath: '/run/diff.patch',
    runDir: '/run',
    batchSize: 30,
  })
  expect(prompts).toHaveLength(2)
  const first = section(prompts[0]?.prompt ?? '', 'C', 'M') as Array<{ id: string }>
  const second = section(prompts[1]?.prompt ?? '', 'C', 'M') as Array<{ id: string }>
  expect(first.map((c) => c.id)).toContain('c31')
  expect(second.map((c) => c.id)).toEqual(['c32', 'c33', 'c34', 'c35'])
  expect(section(prompts[0]?.prompt ?? '', 'M', 'R')).toEqual([['c30', 'c31']])
  expect(section(prompts[1]?.prompt ?? '', 'M', 'R')).toEqual([])
})

test('a template missing placeholders throws naming each missing one', () => {
  expect(() =>
    buildCriticPrompts({
      template: 'only <<CANDIDATES>> and <<OUTPUT_PATH>>',
      candidates: candidates(1),
      mergeCandidates: [],
      reviewRules: [],
      worktree: '/run/worktree',
      diffPath: '/run/diff.patch',
      runDir: '/run',
      batchSize: 30,
    }),
  ).toThrow('<<MERGE_CANDIDATES>>, <<REVIEW_RULES>>, <<WORKTREE>>, <<DIFF_PATH>>')
})
