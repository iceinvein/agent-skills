import { expect, test } from 'bun:test'
import { computeCoverage, renderCoverage } from '../coverage.ts'
import type { HandoffFile } from '../handoff.ts'
import type { Requirement, Throughput } from '../types.ts'

function req(id: string, cap: string, confidence: Requirement['confidence']): Requirement {
  return {
    id,
    cap,
    requirement: `requirement ${id}`,
    actors: 'User',
    objects: 'Thing',
    rules: 'none',
    origin: 'intended',
    confidence,
    citations: [],
    parity: { kind: 'rubric', level: 'high' },
    batch: 'b-1',
  }
}

const CONFIRMED: Requirement['confidence'] = { kind: 'confirmed' }
const INFERRED: Requirement['confidence'] = { kind: 'inferred' }

const REQS = [
  req('UM-001', 'user-management', CONFIRMED),
  req('UM-002', 'user-management', CONFIRMED),
  req('BI-001', 'billing', CONFIRMED),
  req('BI-002', 'billing', INFERRED),
  req('BI-003', 'billing', INFERRED),
]

const HANDOFF: HandoffFile = {
  version: 1,
  adapter: 'markdown',
  items: [
    {
      key: 'billing',
      title: 'Billing',
      frs: ['BI-001', 'BI-002', 'BI-003'],
      dependsOn: [],
      weight: 3,
    },
    {
      key: 'user-management',
      title: 'User management',
      frs: ['UM-001', 'UM-002'],
      dependsOn: ['billing'],
      weight: 2,
    },
  ],
  refs: {},
  basis: { confirmed: 3, emitted: 5, order: ['billing', 'user-management'] },
}

const through = (completions: Throughput['completions']): Throughput => ({
  completions,
  basis: 'markdown roadmap checkboxes, dated in file',
})

test('the denominator is confirmed requirements only, with exclusions reported', () => {
  const r = computeCoverage({
    requirements: REQS,
    handoff: HANDOFF,
    throughput: through([
      { fr: 'UM-001', doneAt: '2026-08-12' },
      { fr: 'BI-001', doneAt: '2026-08-11' },
    ]),
  })
  // Five requirements exist; three are confirmed; two of those are built.
  expect(r.confirmed).toBe(3)
  expect(r.built).toBe(2)
  expect(r.nonConfirmed).toEqual([{ slug: 'billing', count: 2 }])
})

test('a completion for a non-confirmed requirement does not inflate the figure', () => {
  // BI-002 is inferred, so it is outside the denominator. Reporting it as
  // complete must not push built above the confirmed total it sits over.
  const r = computeCoverage({
    requirements: REQS,
    handoff: HANDOFF,
    throughput: through([
      { fr: 'BI-001', doneAt: '2026-08-11' },
      { fr: 'BI-002', doneAt: '2026-08-11' },
    ]),
  })
  expect(r.built).toBe(1)
  expect(r.confirmed).toBe(3)
  expect(r.unknown).toEqual([])
})

test('capabilities are reported in the emitted dependency order', () => {
  const r = computeCoverage({ requirements: REQS, handoff: HANDOFF, throughput: through([]) })
  expect(r.caps.map((c) => c.slug)).toEqual(['billing', 'user-management'])
})

test('an undated completion counts as built and is reported as undated', () => {
  const r = computeCoverage({
    requirements: REQS,
    handoff: HANDOFF,
    throughput: through([{ fr: 'UM-001', doneAt: null }]),
  })
  expect(r.built).toBe(1)
  expect(r.undated).toBe(1)
  expect(renderCoverage(r)).toContain('undated: 1 completion(s)')
})

test('a completion naming an unknown requirement is collected, not counted', () => {
  const r = computeCoverage({
    requirements: REQS,
    handoff: HANDOFF,
    throughput: through([
      { fr: 'UM-001', doneAt: '2026-08-12' },
      { fr: 'ZZ-999', doneAt: '2026-08-12' },
    ]),
  })
  expect(r.unknown).toEqual(['ZZ-999'])
  expect(r.built).toBe(1)
})

test('the rendered report names its evidence and marks a finished capability', () => {
  const r = computeCoverage({
    requirements: REQS,
    handoff: HANDOFF,
    throughput: through([
      { fr: 'UM-001', doneAt: '2026-08-12' },
      { fr: 'UM-002', doneAt: '2026-08-13' },
    ]),
  })
  expect(renderCoverage(r)).toBe(
    [
      'built 2/3 confirmed requirements (67%)',
      'evidence: markdown roadmap checkboxes, dated in file',
      'excluded: 2 non-confirmed (billing 2)',
      '',
      'billing          0/1',
      'user-management  2/2  done',
    ].join('\n'),
  )
})

test('a store with no confirmed requirements reports zero rather than dividing by zero', () => {
  const r = computeCoverage({
    requirements: [req('BI-002', 'billing', INFERRED)],
    handoff: { ...HANDOFF, basis: { confirmed: 0, emitted: 1, order: ['billing'] } },
    throughput: through([]),
  })
  expect(r.confirmed).toBe(0)
  expect(renderCoverage(r)).toContain('built 0/0 confirmed requirements (0%)')
})

test('a capability the emitted order omits is counted and named as stale', () => {
  // A stale handoff.json used to narrow both numerator and denominator
  // silently, reporting 100% while confirmed requirements sat unbuilt in a
  // capability that appeared nowhere in the output.
  const r = computeCoverage({
    requirements: REQS,
    handoff: { ...HANDOFF, basis: { confirmed: 3, emitted: 5, order: ['user-management'] } },
    throughput: through([
      { fr: 'UM-001', doneAt: '2026-08-12' },
      { fr: 'UM-002', doneAt: '2026-08-13' },
    ]),
  })
  expect(r.confirmed).toBe(3)
  expect(r.built).toBe(2)
  expect(r.stale).toEqual(['billing'])
  expect(r.caps.map((c) => c.slug)).toEqual(['user-management', 'billing'])
  expect(renderCoverage(r)).toContain('stale: 1 capability(ies) not in the emitted work (billing)')
})

test('the percentage never contradicts the fraction beside it', () => {
  const at = (built: number, confirmed: number): string => {
    const reqs = Array.from({ length: confirmed }, (_, i) => req(`X-${i}`, 'billing', CONFIRMED))
    return renderCoverage(
      computeCoverage({
        requirements: reqs,
        handoff: {
          ...HANDOFF,
          items: [],
          basis: { confirmed, emitted: confirmed, order: ['billing'] },
        },
        throughput: through(
          Array.from({ length: built }, (_, i) => ({ fr: `X-${i}`, doneAt: '2026-08-12' })),
        ),
      }),
    )
  }
  expect(at(199, 200)).toContain('built 199/200 confirmed requirements (99%)')
  expect(at(1, 250)).toContain('built 1/250 confirmed requirements (1%)')
  expect(at(200, 200)).toContain('(100%)')
  expect(at(0, 200)).toContain('(0%)')
})
