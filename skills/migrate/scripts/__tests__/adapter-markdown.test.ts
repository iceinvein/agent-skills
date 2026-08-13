import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { markdown, parseRoadmap } from '../adapters/markdown.ts'
import type { Config } from '../config.ts'
import { buildWorkItems, type HandoffInput } from '../handoff.ts'
import type { Capability, Requirement } from '../types.ts'

let root: string

const config = (): Config => ({
  source: {
    path: join(root, 'legacy'),
    scope: 'x',
    stack: 'unknown',
    vcs: 'none',
    basis: 'source-only',
  },
  target: {
    name: 'target',
    stack: 'unknown',
    parity_test_path: 'tests/parity/{capability}/{fr_slug}.test.ts',
    layout: {},
    commands: {},
  },
  surfaces: ['routes'],
  surfaceSingular: {},
  closers: [],
  handoff: { adapter: 'markdown' },
})

function cap(slug: string, title: string, elements: string[]): Capability {
  return { slug, title, ns: slug.slice(0, 2).toUpperCase(), elements }
}

function req(id: string, capSlug: string, text: string, cites: string[] = []): Requirement {
  return {
    id,
    cap: capSlug,
    requirement: text,
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

const CAPS = [
  cap('billing', 'Billing', ['el-b']),
  cap('user-management', 'User management', ['el-u']),
]
const REQS = [
  req('UM-001', 'user-management', 'Authenticate a user against stored credentials', ['el-b']),
  req('UM-002', 'user-management', 'Lock an account after five failed attempts'),
  req('BI-001', 'billing', 'Raise an invoice for a completed booking'),
]

function input(caps = CAPS, reqs = REQS): HandoffInput {
  return {
    requirements: reqs,
    capabilities: caps,
    deltas: [],
    config: config(),
    root,
    gitBin: 'git',
    ghBin: 'gh',
  }
}

const roadmapPath = (): string => join(root, 'docs', 'migrate', 'roadmap.md')

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'migrate-md-adapter-'))
  await Bun.write(join(root, 'legacy', 'app.js'), '// legacy\n')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

test('apply writes a roadmap in dependency order and one file per capability', async () => {
  const items = buildWorkItems(CAPS, REQS)
  const result = await markdown.apply(items, input())

  expect(result.created.sort()).toEqual(['billing', 'user-management'])
  expect(result.unchanged).toEqual([])
  expect(result.refs['billing']).toBe('docs/migrate/capabilities/billing.md')

  const roadmap = await readFile(roadmapPath(), 'utf8')
  // billing owns the element user-management cites, so it comes first.
  expect(roadmap.indexOf('Billing')).toBeLessThan(roadmap.indexOf('User management'))
  expect(roadmap).toContain('- [ ] BI-001 Raise an invoice for a completed booking')
  expect(roadmap).toContain('- [ ] UM-001 Authenticate a user against stored credentials')

  const capFile = await readFile(
    join(root, 'docs', 'migrate', 'capabilities', 'user-management.md'),
    'utf8',
  )
  expect(capFile).toContain('# User management')
  expect(capFile).toContain('UM-001')
  expect(capFile).toContain('billing')
})

test('re-applying preserves every ticked box and its date', async () => {
  const items = buildWorkItems(CAPS, REQS)
  await markdown.apply(items, input())

  // The owner ticks two boxes by hand, one with a date and one without.
  const before = await readFile(roadmapPath(), 'utf8')
  await writeFile(
    roadmapPath(),
    before
      .replace(
        '- [ ] UM-001 Authenticate a user against stored credentials',
        '- [x] UM-001 <!-- done:2026-08-12 --> Authenticate a user against stored credentials',
      )
      .replace('- [ ] BI-001 ', '- [x] BI-001 '),
  )

  // A new requirement lands and handoff runs again.
  const grown = [...REQS, req('UM-003', 'user-management', 'Expire a session after idle time')]
  await markdown.apply(buildWorkItems(CAPS, grown), input(CAPS, grown))

  const after = await readFile(roadmapPath(), 'utf8')
  expect(after).toContain(
    '- [x] UM-001 <!-- done:2026-08-12 --> Authenticate a user against stored credentials',
  )
  expect(after).toContain('- [x] BI-001 Raise an invoice for a completed booking')
  expect(after).toContain('- [ ] UM-003 Expire a session after idle time')
})

test('throughput reads ticked boxes, with a null date for an undated tick', async () => {
  const items = buildWorkItems(CAPS, REQS)
  await markdown.apply(items, input())
  const before = await readFile(roadmapPath(), 'utf8')
  await writeFile(
    roadmapPath(),
    before
      .replace('- [ ] UM-001 ', '- [x] UM-001 <!-- done:2026-08-12 --> ')
      .replace('- [ ] BI-001 ', '- [x] BI-001 '),
  )

  const t = await markdown.throughput?.(input())
  expect(t?.completions).toEqual([
    { fr: 'BI-001', doneAt: null },
    { fr: 'UM-001', doneAt: '2026-08-12' },
  ])
  expect(t?.basis).toContain('roadmap')
})

test('throughput on a roadmap that was never written reports nothing built', async () => {
  const t = await markdown.throughput?.(input())
  expect(t?.completions).toEqual([])
})

test('a second apply over an unchanged store reports every item unchanged', async () => {
  const items = buildWorkItems(CAPS, REQS)
  await markdown.apply(items, input())
  const second = await markdown.apply(items, input())
  expect(second.created).toEqual([])
  expect(second.updated).toEqual([])
  expect(second.unchanged.sort()).toEqual(['billing', 'user-management'])
})

test('plan is apply-free: it writes nothing', async () => {
  const items = await markdown.plan(input())
  expect(items.map((i) => i.key)).toEqual(['billing', 'user-management'])
  expect(await Bun.file(roadmapPath()).exists()).toBe(false)
})

test('a requirement whose text opens with a parenthesised date is not read as dated', () => {
  // The date lives in an HTML comment precisely so ordinary requirement prose
  // cannot fabricate one. Parenthesised, this parsed as a completion date and
  // fed a number nobody recorded into the measured velocity.
  const roadmap = '- [x] BI-001 (2026-08-12) Raise an invoice\n'
  const state = parseRoadmap(roadmap)
  expect(state.get('BI-001')).toEqual({ checked: true, date: null })
})
