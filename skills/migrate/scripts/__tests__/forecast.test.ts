import { expect, test } from 'bun:test'
import { parseAssumptions } from '../assumptions.ts'
import type { CapCoverage } from '../coverage.ts'
import { addDays, demandOf, project, renderForecast, velocities } from '../forecast.ts'
import type { Completion } from '../types.ts'

const ASSUMPTIONS = parseAssumptions(
  `---
attestedBy: Dik Rana
attestedDate: 2026-08-13
---

## Territories

| capability | territory |
| --- | --- |
| user-management | established |
| billing | unknown-ground |

## Multipliers

| territory | multiplier |
| --- | --- |
| established | 1.0 |
| unknown-ground | 2.5 |

## Scenarios

| label | rate | streams | tax | note |
| --- | --- | --- | --- | --- |
| steady | as-is | 1 | 0 | one stream at the measured pace |
| target | 2 | 1 | 0 | owner target, nothing measures this |

## Caveats

- Billing has no precedent here.
`,
  'f.md',
)

// billing: 3 confirmed, 1 covered, 2 remaining. user-management: 2 confirmed,
// 0 covered, 2 remaining. Raw demand 4; weighted 2*2.5 + 2*1.0 = 7.
const COVERAGE: CapCoverage[] = [
  {
    slug: 'billing',
    title: 'Billing',
    confirmedTotal: 3,
    covered: 1,
    coveredIds: ['BI-001'],
    uncoveredIds: ['BI-002', 'BI-003'],
  },
  {
    slug: 'user-management',
    title: 'User management',
    confirmedTotal: 2,
    covered: 0,
    coveredIds: [],
    uncoveredIds: ['UM-001', 'UM-002'],
  },
]

const TODAY = '2026-08-11'
const DATED: Completion[] = [
  { fr: 'BI-001', doneAt: '2026-08-01' },
  { fr: 'BI-004', doneAt: '2026-08-03' },
  { fr: 'BI-005', doneAt: '2026-08-05' },
]

test('addDays crosses a month boundary', () => {
  expect(addDays('2026-08-11', 24)).toBe('2026-09-04')
})

test('demand is reported both raw and weighted by attested multiplier', () => {
  const d = demandOf(ASSUMPTIONS, COVERAGE)
  expect(d.remainingRaw).toBe(4)
  expect(d.remainingWeighted).toBe(7)
  // Territories come out in Multipliers-table order, which is what the
  // milestone sequence walks.
  expect(d.territories.map((t) => t.territory)).toEqual(['established', 'unknown-ground'])
  expect(d.territories[1]?.frEquivalents).toBe(5)
})

test('two measured velocities: calendar days and active days', () => {
  const v = velocities(DATED, TODAY)
  // Three completions over ten calendar days since the first.
  expect(v.asIs.value).toBeCloseTo(0.3, 10)
  expect(v.asIs.basis).toContain('quiet days included')
  // Three completions over three days on which something completed.
  expect(v.active.value).toBe(1)
  expect(v.active.basis).toContain('something completed')
})

test('fewer than two dated completions leaves both velocities unmeasured', () => {
  const one = velocities([{ fr: 'BI-001', doneAt: '2026-08-01' }], TODAY)
  expect(one.asIs.value).toBeNull()
  expect(one.active.value).toBeNull()
  expect(one.asIs.basis).toContain('one point is not a rate')

  // Undated completions never contribute to a rate, so three of them are still
  // nothing to measure from.
  const undated = velocities(
    [
      { fr: 'A', doneAt: null },
      { fr: 'B', doneAt: null },
      { fr: 'C', doneAt: null },
    ],
    TODAY,
  )
  expect(undated.asIs.value).toBeNull()
})

test('a measured scenario projects raw and weighted finishes and carries a band', () => {
  const projections = project({
    assumptions: ASSUMPTIONS,
    demand: demandOf(ASSUMPTIONS, COVERAGE),
    velocity: velocities(DATED, TODAY),
    today: TODAY,
  })
  const steady = projections[0]
  expect(steady?.basis).toBe('as-is')
  expect(steady?.perDay).toBeCloseTo(0.3, 10)
  // 4 raw at 0.3/day is 14 days; 7 weighted is 24.
  expect(steady?.daysRaw).toBe(14)
  expect(steady?.finishRaw).toBe('2026-08-25')
  expect(steady?.daysWeighted).toBe(24)
  expect(steady?.finishWeighted).toBe('2026-09-04')
  // The band applies the same streams and tax to both measured bases.
  expect(steady?.band).toEqual({ optimistic: '2026-08-18', pessimistic: '2026-09-04' })
  // Milestones accumulate weighted demand in Multipliers order.
  expect(steady?.milestones).toEqual([
    { territory: 'established', finish: '2026-08-18' },
    { territory: 'unknown-ground', finish: '2026-09-04' },
  ])
})

test('an owner target projects but carries no band, and is labelled as a target', () => {
  const projections = project({
    assumptions: ASSUMPTIONS,
    demand: demandOf(ASSUMPTIONS, COVERAGE),
    velocity: velocities(DATED, TODAY),
    today: TODAY,
  })
  const target = projections[1]
  expect(target?.basis).toBe('target')
  expect(target?.perDay).toBe(2)
  expect(target?.daysWeighted).toBe(4)
  expect(target?.finishWeighted).toBe('2026-08-15')
  // No measured spread backs an attested rate, so no band is offered.
  expect(target?.band).toBeNull()
})

test('with no measured velocity a target still projects and a measured row does not', () => {
  // This is the flow adapter's situation exactly: coverage but no dates.
  const projections = project({
    assumptions: ASSUMPTIONS,
    demand: demandOf(ASSUMPTIONS, COVERAGE),
    velocity: velocities([], TODAY),
    today: TODAY,
  })
  expect(projections[0]?.perDay).toBeNull()
  expect(projections[0]?.finishWeighted).toBeNull()
  // Still a band, with both ends unmeasurable. An absent band means a target
  // row, which is a different claim from a measured row nothing can date yet.
  expect(projections[0]?.band).toEqual({ optimistic: null, pessimistic: null })
  expect(projections[1]?.finishWeighted).toBe('2026-08-15')
})

test('the rendered forecast separates measured rows from targets and prints caveats', () => {
  const out = renderForecast({
    assumptions: ASSUMPTIONS,
    demand: demandOf(ASSUMPTIONS, COVERAGE),
    velocity: velocities(DATED, TODAY),
    projections: project({
      assumptions: ASSUMPTIONS,
      demand: demandOf(ASSUMPTIONS, COVERAGE),
      velocity: velocities(DATED, TODAY),
      today: TODAY,
    }),
    today: TODAY,
    undated: 2,
  })
  expect(out).toContain('attested by Dik Rana on 2026-08-13')
  expect(out).toContain('remaining 4 requirement(s), 7 weighted')
  expect(out).toContain('steady')
  expect(out).toContain('measured')
  expect(out).toContain('target (owner-attested, nothing measures this)')
  expect(out).toContain('Billing has no precedent here.')
  expect(out).toContain('2 completion(s) carry no date')
})

test('an unprojectable measured row says so rather than printing nothing', () => {
  const out = renderForecast({
    assumptions: ASSUMPTIONS,
    demand: demandOf(ASSUMPTIONS, COVERAGE),
    velocity: velocities([], TODAY),
    projections: project({
      assumptions: ASSUMPTIONS,
      demand: demandOf(ASSUMPTIONS, COVERAGE),
      velocity: velocities([], TODAY),
      today: TODAY,
    }),
    today: TODAY,
    undated: 0,
  })
  expect(out).toContain('not projected')
})
