import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { blockedRequirements } from '../handoff.ts'
import { runHandoff } from '../handoff-cmd.ts'
import type { Requirement } from '../types.ts'

let root: string
let source: string

function req(id: string, over: Partial<Requirement> = {}): Requirement {
  return {
    id,
    cap: 'user-management',
    requirement: `requirement ${id}`,
    actors: 'User',
    objects: 'Thing',
    rules: 'none',
    origin: 'intended',
    confidence: { kind: 'confirmed' },
    citations: [{ kind: 'src', path: 'app.js', lines: [1, 1] }],
    parity: { kind: 'rubric', level: 'high' },
    batch: 'b-extract-1',
    ...over,
  }
}

const PHASES = ['probe', 'enumerate', 'seam', 'extract', 'parity', 'queue', 'adjudicate', 'handoff']

async function jsonl(name: string, rows: unknown[]): Promise<void> {
  await writeFile(join(root, '.migrate', name), rows.map((r) => `${JSON.stringify(r)}\n`).join(''))
}

// A complete, gate-clean store with one declared surface and no closers, so a
// handoff test does not have to satisfy eight lens censuses to reach the thing
// it is actually asserting.
async function store(over: { requirements?: Requirement[]; queueStatus?: string } = {}) {
  await mkdir(join(root, '.migrate', 'queue'), { recursive: true })
  await writeFile(
    join(root, '.migrate', 'config.toml'),
    [
      '[source]',
      `path = "${source}"`,
      'scope = "handoff fixture"',
      'stack = "unknown"',
      'vcs = "none"',
      'basis = "source-only"',
      '',
      '[target]',
      'name = "target"',
      'stack = "unknown"',
      'parity_test_path = "tests/parity/{capability}/{fr_slug}.test.ts"',
      '',
      '[surfaces]',
      'types = ["routes"]',
      '',
      '[closers]',
      'set = []',
      '',
      '[handoff]',
      'adapter = "markdown"',
      '',
    ].join('\n'),
  )

  const requirements = over.requirements ?? [req('UM-001'), req('UM-002')]
  await jsonl('elements.jsonl', [
    {
      id: 'route-get-users',
      surface: 'routes',
      element: 'GET /users',
      found_by: ['code'],
      disposition: { kind: 'mapped', fr: 'UM-001' },
      refs: [],
      lens: 'code',
      batch: 'b-routes-1',
      notes: '',
    },
  ])
  await jsonl('requirements.jsonl', requirements)
  await jsonl('capabilities.jsonl', [
    {
      slug: 'user-management',
      title: 'User management',
      ns: 'UM',
      elements: ['route-get-users'],
    },
  ])
  await jsonl('census.jsonl', [
    {
      kind: 'lens',
      surface: 'routes',
      phase: 'enumerate',
      directions: {
        code: { count: 1, evidence: 'grep app.get' },
        nav: { count: 1, evidence: 'walked the router' },
      },
      total: 1,
      in_ledger: 0,
      added: 1,
      skipped: [],
      queued: [],
      batch: 'b-routes-1',
    },
  ])

  await writeFile(
    join(root, '.migrate', 'queue', 'q-open-question.md'),
    [
      '---',
      'id: q-open-question',
      'severity: moderate',
      `status: ${over.queueStatus ?? 'adjudicated'}`,
      ...(over.queueStatus === 'open' ? [] : ['ruling: settled in favour of billing']),
      '---',
      '',
      '## Evidence',
      '',
      'e',
      '',
      '## Options',
      '',
      'o',
      '',
      '## Recommendation',
      '',
      'r',
      '',
    ].join('\n'),
  )

  const phases: Record<string, unknown> = {}
  for (const p of PHASES) {
    phases[p] = {
      status: 'done',
      batches:
        p === 'enumerate'
          ? [{ id: 'b-routes-1', count: 1 }]
          : p === 'extract'
            ? [{ id: 'b-extract-1', count: requirements.length }]
            : [],
      pending: [],
    }
  }
  // handoff has not run yet: this is the command under test.
  phases.handoff = { status: 'pending', batches: [], pending: [] }
  await writeFile(
    join(root, '.migrate', 'phases.json'),
    JSON.stringify({ version: 1, phases }, null, 2),
  )
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'migrate-handoff-'))
  source = join(root, 'legacy')
  await Bun.write(join(source, 'app.js'), '// legacy\n')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

// --- blockedRequirements, pure ---

test('a queued confidence blocks only while its queue item is open', () => {
  const queued = req('UM-001', { confidence: { kind: 'queued', queue: 'q-x' } })

  expect(blockedRequirements([queued], new Set(['q-x']))).toEqual([{ fr: 'UM-001', queue: 'q-x' }])
  // The correction this milestone exists to make. Once the item is
  // adjudicated it is no longer open, the decision is settled, and the
  // requirement must stop blocking handoff even though its confidence still
  // reads `queued`. Treating any queued confidence as a blocker would refuse
  // handoff forever unless every such requirement were re-imported first.
  expect(blockedRequirements([queued], new Set())).toEqual([])
})

test('a sub-high rubric parity blocks on its own queue item', () => {
  const moderate = req('UM-002', {
    parity: { kind: 'rubric', level: 'moderate', queue: 'q-y' },
  })
  expect(blockedRequirements([moderate], new Set(['q-y']))).toEqual([
    { fr: 'UM-002', queue: 'q-y' },
  ])
  expect(blockedRequirements([moderate], new Set())).toEqual([])
})

test('a high rubric and a differential parity never block', () => {
  const high = req('UM-003')
  const differential = req('UM-004', { parity: { kind: 'differential', ref: 't.test.ts' } })
  expect(blockedRequirements([high, differential], new Set(['q-x']))).toEqual([])
})

test('one requirement blocked from both directions is reported once per path', () => {
  const both = req('UM-005', {
    confidence: { kind: 'queued', queue: 'q-a' },
    parity: { kind: 'rubric', level: 'low', queue: 'q-b' },
  })
  expect(blockedRequirements([both], new Set(['q-a', 'q-b']))).toEqual([
    { fr: 'UM-005', queue: 'q-a' },
    { fr: 'UM-005', queue: 'q-b' },
  ])
})

// --- the verb ---

test('handoff writes handoff.json and records the phase batch', async () => {
  await store()
  const code = await runHandoff({ root })
  expect(code).toBe(0)

  const file = JSON.parse(await readFile(join(root, '.migrate', 'handoff.json'), 'utf8'))
  expect(file.adapter).toBe('markdown')
  expect(file.items).toHaveLength(1)
  expect(file.items[0].frs).toEqual(['UM-001', 'UM-002'])
  expect(file.basis).toEqual({ confirmed: 2, emitted: 2, order: ['user-management'] })
  // The stored item drops the rendered body, which is regenerated on every
  // plan() and would otherwise churn the file on wording alone.
  expect(file.items[0].body).toBeUndefined()

  const phases = JSON.parse(await readFile(join(root, '.migrate', 'phases.json'), 'utf8'))
  expect(phases.phases.handoff.batches).toHaveLength(1)
})

test('handoff.json is byte-identical across two runs over one store', async () => {
  await store()
  await runHandoff({ root })
  const first = await readFile(join(root, '.migrate', 'handoff.json'), 'utf8')
  await runHandoff({ root })
  const second = await readFile(join(root, '.migrate', 'handoff.json'), 'utf8')
  expect(second).toBe(first)
})

test('handoff refuses while a queue item is open, naming it', async () => {
  await store({ queueStatus: 'open' })
  const code = await runHandoff({ root })
  expect(code).toBe(1)
  expect(await Bun.file(join(root, '.migrate', 'handoff.json')).exists()).toBe(false)
})

test('handoff refuses a requirement blocked by an open item, naming both', async () => {
  await store({
    requirements: [
      req('UM-001'),
      req('UM-002', { confidence: { kind: 'queued', queue: 'q-open-question' } }),
    ],
    queueStatus: 'open',
  })
  const code = await runHandoff({ root })
  expect(code).toBe(1)
})

test('--dry-run runs the preflight and writes nothing', async () => {
  await store()
  const code = await runHandoff({ root, dryRun: true })
  expect(code).toBe(0)
  expect(await Bun.file(join(root, '.migrate', 'handoff.json')).exists()).toBe(false)
  expect(await Bun.file(join(root, 'docs', 'migrate', 'roadmap.md')).exists()).toBe(false)
})

test('--dry-run still refuses on an open queue item', async () => {
  await store({ queueStatus: 'open' })
  expect(await runHandoff({ root, dryRun: true })).toBe(1)
})

test('an unknown adapter is a usage error naming the three that exist', async () => {
  await store()
  const code = await runHandoff({ root, adapter: 'jira' })
  expect(code).toBe(2)
})

test('the preflight is bounded at adjudicate, so gate 12 cannot block the run that satisfies it', async () => {
  // handoff.json does not exist yet, and gate 12 requires it. An unbounded
  // preflight would therefore refuse every first handoff, forever.
  await store()
  expect(await runHandoff({ root })).toBe(0)
})
