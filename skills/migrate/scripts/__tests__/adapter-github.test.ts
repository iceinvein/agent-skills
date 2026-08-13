import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { github } from '../adapters/github.ts'
import type { Config } from '../config.ts'
import { buildWorkItems, type HandoffInput } from '../handoff.ts'
import type { Capability, Requirement } from '../types.ts'

const FAKE_GH = join(import.meta.dir, '..', '..', 'fixtures', 'fake-gh.ts')

let root: string
let statePath: string
let logPath: string

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
  handoff: { adapter: 'github' },
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
  req('UM-001', 'user-management', 'Authenticate a user', ['el-b']),
  req('UM-002', 'user-management', 'Lock an account'),
  req('BI-001', 'billing', 'Raise an invoice'),
]

function input(reqs = REQS): HandoffInput {
  return {
    requirements: reqs,
    capabilities: CAPS,
    deltas: [],
    config: config(),
    root,
    gitBin: 'git',
    ghBin: FAKE_GH,
  }
}

async function log(): Promise<string[]> {
  const text = await readFile(logPath, 'utf8')
  return text.split('\n').filter((l) => l.length > 0)
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'migrate-gh-adapter-'))
  await Bun.write(join(root, 'legacy', 'app.js'), '// legacy\n')
  // The fake gh keys its state and log off its working directory, which the
  // adapter sets to the target root.
  statePath = join(root, 'gh-state.json')
  logPath = join(root, 'gh-log.txt')
  await writeFile(logPath, '')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

test('apply creates one milestone per capability and one issue per requirement', async () => {
  const result = await github.apply(buildWorkItems(CAPS, REQS), input())

  expect(result.created.sort()).toEqual(['billing', 'user-management'])
  // The ref is the milestone the capability's issues were filed under.
  expect(result.refs['billing']).toBe('milestone:1')

  const lines = await log()
  expect(lines.filter((l) => l.includes('-X POST'))).toHaveLength(2)
  expect(lines.filter((l) => l.startsWith('issue create'))).toHaveLength(3)
  // Every issue body carries the marker that makes the next run idempotent.
  const state = JSON.parse(await readFile(statePath, 'utf8'))
  expect(state.issues).toHaveLength(3)
  expect(state.issues[0].body).toContain('<!-- migrate:fr=')
  expect(state.issues.map((i: { milestone: string }) => i.milestone).sort()).toEqual([
    'Billing',
    'User management',
    'User management',
  ])
})

test('a second apply creates nothing and reports every item unchanged', async () => {
  const items = buildWorkItems(CAPS, REQS)
  await github.apply(items, input())
  await writeFile(logPath, '')

  const second = await github.apply(items, input())
  expect(second.created).toEqual([])
  expect(second.updated).toEqual([])
  expect(second.unchanged.sort()).toEqual(['billing', 'user-management'])

  const lines = await log()
  expect(lines.filter((l) => l.startsWith('issue create'))).toHaveLength(0)
  expect(lines.filter((l) => l.includes('-X POST'))).toHaveLength(0)
})

test('an issue found only by its marker is edited rather than duplicated', async () => {
  await github.apply(buildWorkItems(CAPS, REQS), input())

  // The requirement's text changes, so its issue body must be brought up to
  // date. The adapter has no stored ref for the issue: the marker in the body
  // is the whole identity mechanism, which is what makes this safe after a
  // lost handoff.json.
  const edited = [
    req('UM-001', 'user-management', 'Authenticate a user against stored credentials', ['el-b']),
    req('UM-002', 'user-management', 'Lock an account'),
    req('BI-001', 'billing', 'Raise an invoice'),
  ]
  await writeFile(logPath, '')
  const second = await github.apply(buildWorkItems(CAPS, edited), input(edited))

  expect(second.updated).toEqual(['user-management'])
  expect(second.unchanged).toEqual(['billing'])
  const lines = await log()
  expect(lines.filter((l) => l.startsWith('issue create'))).toHaveLength(0)
  expect(lines.filter((l) => l.startsWith('issue edit'))).toHaveLength(1)

  const state = JSON.parse(await readFile(statePath, 'utf8'))
  expect(state.issues).toHaveLength(3)
  const um1 = state.issues.filter((i: { body: string }) => i.body.includes('migrate:fr=UM-001'))
  // Exactly one issue still carries the marker: the edit updated it in place
  // rather than filing a second issue for the same requirement.
  expect(um1).toHaveLength(1)
  expect(um1[0].body).toContain('against stored credentials')
})

test('throughput reads closed issues and dates them from closedAt', async () => {
  await github.apply(buildWorkItems(CAPS, REQS), input())

  // Found by marker, not by index: billing sorts first in dependency order, so
  // issue 0 is BI-001.
  const state = JSON.parse(await readFile(statePath, 'utf8'))
  const target = state.issues.find((i: { body: string }) => i.body.includes('migrate:fr=UM-001'))
  target.state = 'CLOSED'
  target.closedAt = '2026-08-12T04:11:00Z'
  await writeFile(statePath, JSON.stringify(state, null, 2))

  const t = await github.throughput?.(input())
  expect(t?.completions).toEqual([{ fr: 'UM-001', doneAt: '2026-08-12' }])
  expect(t?.basis).toContain('closed')
})

test('an issue with no marker is ignored rather than mistaken for a requirement', async () => {
  await github.apply(buildWorkItems(CAPS, REQS), input())
  const state = JSON.parse(await readFile(statePath, 'utf8'))
  state.issues.push({
    number: 500,
    title: 'Someone else’s issue',
    body: 'Nothing to do with the migration.',
    state: 'CLOSED',
    closedAt: '2026-08-01T00:00:00Z',
    milestone: null,
  })
  await writeFile(statePath, JSON.stringify(state, null, 2))

  const t = await github.throughput?.(input())
  expect(t?.completions).toEqual([])
})
