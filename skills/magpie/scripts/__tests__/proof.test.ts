import { expect, test } from 'bun:test'
import {
  applyProofResults,
  buildProofPrompts,
  type ProofResult,
  parseProofResult,
  selectForProof,
} from '../proof.ts'
import type { ReviewFinding, Risk } from '../types.ts'

function finding(id: string, risk: Risk): ReviewFinding {
  return {
    id,
    file: 'src/a.ts',
    line: 10,
    severity: 'high',
    risk,
    title: `title ${id}`,
    description: `description ${id}`,
    domain: 'bugs',
    evidence: 'return cache[key]',
  }
}

const HIGH_SHOULD: Risk = {
  impact: 'high',
  likelihood: 'possible',
  confidence: 'medium',
  action: 'should-fix',
}
const CRITICAL_MUST: Risk = {
  impact: 'critical',
  likelihood: 'likely',
  confidence: 'high',
  action: 'must-fix',
}
const MEDIUM_SHOULD: Risk = { ...HIGH_SHOULD, impact: 'medium' }
const HIGH_CONSIDER: Risk = { ...HIGH_SHOULD, action: 'consider' }

const REPRO = {
  path: 'src/__tests__/magpie-proof-a.test.ts',
  command: 'bun test src/__tests__/magpie-proof-a.test.ts',
  source: "test('x', () => expect(get('k')).toBe(1))",
  output: 'expected 1, received undefined',
}

test('only high or critical findings marked must-fix or should-fix are selected', () => {
  const selected = selectForProof(
    [
      finding('high-should', HIGH_SHOULD),
      finding('medium-should', MEDIUM_SHOULD),
      finding('high-consider', HIGH_CONSIDER),
      finding('critical-must', CRITICAL_MUST),
    ],
    8,
  )
  expect(selected.map((f) => f.id)).toEqual(['critical-must', 'high-should'])
})

test('selection keeps the highest-scoring findings when there are more than the cap', () => {
  const selected = selectForProof(
    [
      finding('low-score', { ...HIGH_SHOULD, likelihood: 'edge-case' }),
      finding('top', CRITICAL_MUST),
      finding('middle', HIGH_SHOULD),
    ],
    2,
  )
  expect(selected.map((f) => f.id)).toEqual(['top', 'middle'])
})

const TEMPLATE = 'F=<<FINDING>> W=<<WORKTREE>> D=<<DIFF_PATH>> O=<<OUTPUT_PATH>>'

test('one prompt per finding, each naming its own output file', () => {
  const prompts = buildProofPrompts({
    template: TEMPLATE,
    findings: [finding('a', HIGH_SHOULD)],
    worktree: '/wt',
    diffPath: '/run/diff.patch',
    runDir: '/run',
  })
  expect(prompts).toHaveLength(1)
  expect(prompts[0]?.id).toBe('a')
  expect(prompts[0]?.outputPath).toBe('/run/proof-a.json')
  expect(prompts[0]?.prompt).toBe(
    `F=${JSON.stringify(
      {
        id: 'a',
        file: 'src/a.ts',
        line: 10,
        risk: HIGH_SHOULD,
        domain: 'bugs',
        title: 'title a',
        description: 'description a',
        evidence: 'return cache[key]',
      },
      null,
      2,
    )} W=/wt D=/run/diff.patch O=/run/proof-a.json`,
  )
})

test('a template missing a placeholder is rejected, naming it', () => {
  expect(() =>
    buildProofPrompts({
      template: 'F=<<FINDING>> W=<<WORKTREE>> D=<<DIFF_PATH>>',
      findings: [],
      worktree: '/wt',
      diffPath: '/d',
      runDir: '/run',
    }),
  ).toThrow('<<OUTPUT_PATH>>')
})

test('an id that is not safe in a file name is rejected', () => {
  expect(() =>
    buildProofPrompts({
      template: TEMPLATE,
      findings: [finding('../x', HIGH_SHOULD)],
      worktree: '/wt',
      diffPath: '/d',
      runDir: '/run',
    }),
  ).toThrow('../x')
})

test('a reproduced result carries its repro', () => {
  expect(
    parseProofResult(
      { id: 'a', outcome: 'reproduced', reason: 'fails as described', repro: REPRO },
      'proof-a.json',
    ),
  ).toEqual({ id: 'a', outcome: 'reproduced', reason: 'fails as described', repro: REPRO })
})

test('a not-proven result needs only a reason', () => {
  expect(
    parseProofResult({ id: 'a', outcome: 'not-proven', reason: 'no test runner' }, 'proof-a.json'),
  ).toEqual({ id: 'a', outcome: 'not-proven', reason: 'no test runner' })
})

test('a reproduced or disproved result without a repro is rejected', () => {
  expect(() =>
    parseProofResult({ id: 'a', outcome: 'reproduced', reason: 'r' }, 'proof-a.json'),
  ).toThrow('proof-a.json: reproduced needs a repro with path, command, source and output')
  expect(() =>
    parseProofResult(
      { id: 'a', outcome: 'disproved', reason: 'r', repro: { ...REPRO, output: '' } },
      'proof-a.json',
    ),
  ).toThrow('proof-a.json: disproved needs a repro with path, command, source and output')
})

test('an unknown outcome is rejected', () => {
  expect(() =>
    parseProofResult({ id: 'a', outcome: 'maybe', reason: 'r' }, 'proof-a.json'),
  ).toThrow('proof-a.json: outcome must be reproduced, disproved or not-proven')
})

test('applying results marks reproduced findings, raises their confidence and keeps the repro', () => {
  // high impact (0.4 x 7) + possible (0.25 x 6) + high confidence (0.2 x 10) + must-fix (0.15 x 10)
  const risk: Risk = { ...HIGH_SHOULD, action: 'must-fix' }
  const a = finding('a', risk)
  const result = applyProofResults({
    findings: [a],
    results: [{ id: 'a', outcome: 'reproduced', reason: 'fails as described', repro: REPRO }],
  })
  expect(result.findings).toEqual([
    {
      ...a,
      risk: { ...risk, confidence: 'high' },
      score: 7.8,
      proof: { status: 'reproduced', reason: 'fails as described', repro: REPRO },
    },
  ])
  expect(result.dropped).toEqual([])
})

test('a not-proven finding keeps its risk and records why', () => {
  const a = finding('a', HIGH_SHOULD)
  const result = applyProofResults({
    findings: [a],
    results: [{ id: 'a', outcome: 'not-proven', reason: 'needs a live database' }],
  })
  expect(result.findings).toEqual([
    { ...a, proof: { status: 'not-proven', reason: 'needs a live database' } },
  ])
})

test('a disproved finding is removed and recorded with its repro', () => {
  const result = applyProofResults({
    findings: [finding('a', HIGH_SHOULD), finding('b', MEDIUM_SHOULD)],
    results: [{ id: 'a', outcome: 'disproved', reason: 'the guard at a.ts:4 holds', repro: REPRO }],
  })
  expect(result.findings.map((f) => f.id)).toEqual(['b'])
  expect(result.dropped).toEqual([
    {
      id: 'a',
      file: 'src/a.ts',
      line: 10,
      title: 'title a',
      reason: 'the guard at a.ts:4 holds',
      repro: REPRO,
    },
  ])
})

test('findings with no result pass through unchanged', () => {
  const b = finding('b', MEDIUM_SHOULD)
  const result = applyProofResults({ findings: [b], results: [] })
  expect(result.findings).toEqual([b])
})

test('a result for an id not in the findings is rejected', () => {
  const results: ProofResult[] = [{ id: 'ghost', outcome: 'not-proven', reason: 'r' }]
  expect(() => applyProofResults({ findings: [], results })).toThrow(
    'proof result for unknown id: ghost',
  )
})
