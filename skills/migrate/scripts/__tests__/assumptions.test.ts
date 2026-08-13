import { expect, test } from 'bun:test'
import { parseAssumptions, validateAssumptions } from '../assumptions.ts'
import type { CapCoverage } from '../coverage.ts'

const GOOD = `---
attestedBy: Dik Rana
attestedDate: 2026-08-13
---

# Forecast assumptions

Prose the parser ignores.

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
| as-is | as-is | 1 | 0 | one stream, measured |
| pushing | active | 2 | 0.2 | two streams, coordination tax |
| target | 1.5 | 2 | 0 | owner target, nothing measures this |

## Caveats

- The billing rewrite has no precedent in this codebase.
`

const cap = (slug: string, confirmedTotal: number): CapCoverage => ({
  slug,
  title: slug,
  confirmedTotal,
  covered: 0,
  coveredIds: [],
  uncoveredIds: [],
})

test('a complete file parses into territories, multipliers, scenarios and caveats', () => {
  const a = parseAssumptions(GOOD, 'f.md')
  expect(a.attestedBy).toBe('Dik Rana')
  expect(a.attestedDate).toBe('2026-08-13')
  expect(a.territories).toEqual({ 'user-management': 'established', billing: 'unknown-ground' })
  expect(a.multipliers).toEqual({ established: 1, 'unknown-ground': 2.5 })
  expect(a.scenarios).toEqual([
    { label: 'as-is', rate: 'as-is', streams: 1, tax: 0, note: 'one stream, measured' },
    {
      label: 'pushing',
      rate: 'active',
      streams: 2,
      tax: 0.2,
      note: 'two streams, coordination tax',
    },
    { label: 'target', rate: 1.5, streams: 2, tax: 0, note: 'owner target, nothing measures this' },
  ])
  expect(a.caveats).toEqual(['The billing rewrite has no precedent in this codebase.'])
})

test('an unattested file is refused, naming the missing field', () => {
  expect(() => parseAssumptions(GOOD.replace('attestedBy: Dik Rana\n', ''), 'f.md')).toThrow(
    /attestedBy/,
  )
  expect(() => parseAssumptions(GOOD.replace('attestedDate: 2026-08-13\n', ''), 'f.md')).toThrow(
    /attestedDate/,
  )
})

test('a missing required section is refused by name', () => {
  const noMultipliers = GOOD.replace(/## Multipliers[\s\S]*?\n\n## Scenarios/, '## Scenarios')
  expect(() => parseAssumptions(noMultipliers, 'f.md')).toThrow(/Multipliers/)
})

test('a scenario rate must be as-is, active, or a positive number', () => {
  const bad = GOOD.replace('| as-is | as-is | 1 | 0 |', '| as-is | sometimes | 1 | 0 |')
  expect(() => parseAssumptions(bad, 'f.md')).toThrow(/rate/)
  const zero = GOOD.replace('| target | 1.5 | 2 | 0 |', '| target | 0 | 2 | 0 |')
  expect(() => parseAssumptions(zero, 'f.md')).toThrow(/rate/)
})

test('tax must sit in [0, 1)', () => {
  expect(() =>
    parseAssumptions(
      GOOD.replace('| pushing | active | 2 | 0.2 |', '| pushing | active | 2 | 1 |'),
      'f.md',
    ),
  ).toThrow(/tax/)
  expect(() =>
    parseAssumptions(
      GOOD.replace('| pushing | active | 2 | 0.2 |', '| pushing | active | 2 | -0.1 |'),
      'f.md',
    ),
  ).toThrow(/tax/)
  // 0.9 is legal.
  expect(
    parseAssumptions(
      GOOD.replace('| pushing | active | 2 | 0.2 |', '| pushing | active | 2 | 0.9 |'),
      'f.md',
    ).scenarios[1]?.tax,
  ).toBe(0.9)
})

test('streams must be positive', () => {
  expect(() =>
    parseAssumptions(
      GOOD.replace('| as-is | as-is | 1 | 0 |', '| as-is | as-is | 0 | 0 |'),
      'f.md',
    ),
  ).toThrow(/streams/)
})

test('a multiplier must be a positive number', () => {
  expect(() =>
    parseAssumptions(GOOD.replace('| established | 1.0 |', '| established | 0 |'), 'f.md'),
  ).toThrow(/multiplier/)
})

test('every parse failure names the file', () => {
  expect(() => parseAssumptions('no frontmatter here', 'docs/x.md')).toThrow(/docs\/x\.md/)
})

// --- validation against measured coverage ---

test('a capability with confirmed requirements and no territory fails by name', () => {
  const a = parseAssumptions(GOOD, 'f.md')
  const errors = validateAssumptions(a, [cap('user-management', 2), cap('notifications', 5)])
  expect(errors).toHaveLength(1)
  expect(errors[0]).toContain('notifications')
})

test('a capability with no confirmed requirements needs no territory', () => {
  const a = parseAssumptions(GOOD, 'f.md')
  expect(validateAssumptions(a, [cap('user-management', 2), cap('notifications', 0)])).toEqual([])
})

test('a territory with no multiplier fails by name', () => {
  const a = parseAssumptions(GOOD.replace('| unknown-ground | 2.5 |\n', ''), 'f.md')
  const errors = validateAssumptions(a, [cap('user-management', 1), cap('billing', 1)])
  expect(errors.some((e) => e.includes('unknown-ground'))).toBe(true)
})

test('zero scenarios fails', () => {
  const a = parseAssumptions(
    GOOD.replace(/\| as-is \| as-is[\s\S]*?nothing measures this \|\n/, ''),
    'f.md',
  )
  expect(a.scenarios).toEqual([])
  expect(validateAssumptions(a, [cap('user-management', 1)])).toContain('no scenarios defined')
})
