import { expect, test } from 'bun:test'
import { buildWorkItems, dependencyOrder } from '../handoff.ts'
import type { Capability, Requirement } from '../types.ts'

function cap(slug: string, elements: string[]): Capability {
  return { slug, title: slug.replace(/-/g, ' '), ns: slug.slice(0, 2).toUpperCase(), elements }
}

// A requirement in `capSlug` citing each of `cites` as a ledger element. The
// edge under test is directional: the capability that owns the cited element
// is the dependency, and the capability doing the citing is the dependent.
function req(id: string, capSlug: string, cites: string[]): Requirement {
  return {
    id,
    cap: capSlug,
    requirement: `requirement ${id}`,
    actors: 'User',
    objects: 'Thing',
    rules: 'none',
    origin: 'intended',
    confidence: { kind: 'confirmed' },
    citations: cites.map((c) => ({ kind: 'ledger' as const, id: c })),
    parity: { kind: 'rubric', level: 'high' },
    batch: 'b-1',
  }
}

const slugs = (caps: Capability[]): string[] => caps.map((c) => c.slug)

test('a chain emits its dependencies first', () => {
  // alpha cites an element owned by beta; beta cites one owned by gamma.
  const caps = [cap('alpha', ['el-a']), cap('beta', ['el-b']), cap('gamma', ['el-c'])]
  const reqs = [
    req('AL-001', 'alpha', ['el-b']),
    req('BE-001', 'beta', ['el-c']),
    req('GA-001', 'gamma', []),
  ]
  const { ordered, cycle } = dependencyOrder(caps, reqs)
  expect(slugs(ordered)).toEqual(['gamma', 'beta', 'alpha'])
  expect(cycle).toEqual([])
})

test('a diamond emits a valid order, deterministically', () => {
  // top depends on left and right; both depend on base.
  const caps = [
    cap('top', ['el-t']),
    cap('left', ['el-l']),
    cap('right', ['el-r']),
    cap('base', ['el-b']),
  ]
  const reqs = [
    req('TO-001', 'top', ['el-l', 'el-r']),
    req('LE-001', 'left', ['el-b']),
    req('RI-001', 'right', ['el-b']),
    req('BA-001', 'base', []),
  ]
  const first = dependencyOrder(caps, reqs)
  expect(slugs(first.ordered)).toEqual(['base', 'left', 'right', 'top'])
  // Re-running over the same input, and over a shuffled input, gives the same
  // answer: the tie between left and right is broken by slug, not by position.
  const shuffled = dependencyOrder([...caps].reverse(), [...reqs].reverse())
  expect(slugs(shuffled.ordered)).toEqual(slugs(first.ordered))
})

test('a cycle emits its members in slug order and reports them', () => {
  const caps = [cap('yin', ['el-y']), cap('yang', ['el-z']), cap('solo', ['el-s'])]
  const reqs = [
    req('YI-001', 'yin', ['el-z']),
    req('YA-001', 'yang', ['el-y']),
    req('SO-001', 'solo', []),
  ]
  const { ordered, cycle } = dependencyOrder(caps, reqs)
  // solo is unblocked and goes first; the two-cycle follows in slug order.
  expect(slugs(ordered)).toEqual(['solo', 'yang', 'yin'])
  expect(cycle).toEqual(['yang', 'yin'])
})

test('a capability whose requirements cite no ledger elements is unblocked', () => {
  const caps = [cap('alpha', ['el-a']), cap('beta', ['el-b'])]
  const reqs = [
    // A src citation is not a ledger citation and creates no edge.
    {
      ...req('AL-001', 'alpha', []),
      citations: [{ kind: 'src' as const, path: 'app.js', lines: [1, 2] as [number, number] }],
    },
    req('BE-001', 'beta', []),
  ]
  const { ordered, cycle } = dependencyOrder(caps, reqs)
  expect(slugs(ordered)).toEqual(['alpha', 'beta'])
  expect(cycle).toEqual([])
})

test('a capability citing an element it owns itself does not depend on itself', () => {
  const caps = [cap('alpha', ['el-a', 'el-a2'])]
  const reqs = [req('AL-001', 'alpha', ['el-a2'])]
  const { ordered, cycle } = dependencyOrder(caps, reqs)
  expect(slugs(ordered)).toEqual(['alpha'])
  expect(cycle).toEqual([])
})

test('buildWorkItems carries frs, weight and dependsOn per capability', () => {
  const caps = [cap('alpha', ['el-a']), cap('beta', ['el-b'])]
  const reqs = [
    req('AL-001', 'alpha', ['el-b']),
    req('AL-002', 'alpha', []),
    req('BE-001', 'beta', []),
  ]
  const items = buildWorkItems(caps, reqs)
  expect(items.map((i) => i.key)).toEqual(['beta', 'alpha'])

  const alpha = items.find((i) => i.key === 'alpha')
  expect(alpha?.frs).toEqual(['AL-001', 'AL-002'])
  expect(alpha?.weight).toBe(2)
  expect(alpha?.dependsOn).toEqual(['beta'])
  expect(alpha?.body).toContain('AL-001')
  expect(alpha?.body).toContain('AL-002')

  const beta = items.find((i) => i.key === 'beta')
  expect(beta?.dependsOn).toEqual([])
  expect(beta?.weight).toBe(1)
})

test('buildWorkItems emits a capability with no requirements at weight zero', () => {
  // An empty capability is still a real partition entry, and dropping it would
  // silently narrow what handoff emitted relative to what the seam decided.
  const items = buildWorkItems([cap('empty', ['el-e'])], [])
  expect(items).toHaveLength(1)
  expect(items[0]?.weight).toBe(0)
  expect(items[0]?.frs).toEqual([])
})

test('only genuine cycle members are reported, and what follows a cycle still sorts', () => {
  // "Everything left is in a cycle" was false: anything transitively blocked
  // by one was reported as a member too, and its satisfiable placement was
  // thrown away. Here yin and yang cycle; alpha depends on yin and zulu on
  // alpha, so both have a valid position after the cycle is broken.
  const caps = [
    cap('yin', ['el-y']),
    cap('yang', ['el-z']),
    cap('alpha', ['el-a']),
    cap('zulu', ['el-u']),
  ]
  const reqs = [
    req('YI-001', 'yin', ['el-z']),
    req('YA-001', 'yang', ['el-y']),
    req('AL-001', 'alpha', ['el-y']),
    req('ZU-001', 'zulu', ['el-a']),
  ]
  const { ordered, cycle } = dependencyOrder(caps, reqs)
  expect(cycle).toEqual(['yang', 'yin'])
  // alpha comes after the cycle it depends on, and zulu after alpha.
  const at = (slug: string): number => slugs(ordered).indexOf(slug)
  expect(at('alpha')).toBeGreaterThan(at('yin'))
  expect(at('zulu')).toBeGreaterThan(at('alpha'))
  expect(slugs(ordered).sort()).toEqual(['alpha', 'yang', 'yin', 'zulu'])
})
