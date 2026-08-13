import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCheck } from '../check.ts'
import type { HandoffFile } from '../handoff.ts'
import type { Requirement, Violation } from '../types.ts'

let root: string
let source: string

const PHASES = ['probe', 'enumerate', 'seam', 'extract', 'parity', 'queue', 'adjudicate', 'handoff']

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

const HANDOFF: HandoffFile = {
  version: 1,
  adapter: 'markdown',
  items: [
    {
      key: 'user-management',
      title: 'User management',
      frs: ['UM-001', 'UM-002'],
      dependsOn: [],
      weight: 2,
    },
  ],
  refs: { 'user-management': 'docs/migrate/capabilities/user-management.md' },
  basis: { confirmed: 2, emitted: 2, order: ['user-management'] },
}

async function jsonl(name: string, rows: unknown[]): Promise<void> {
  await writeFile(join(root, '.migrate', name), rows.map((r) => `${JSON.stringify(r)}\n`).join(''))
}

async function store(
  over: {
    requirements?: Requirement[]
    handoff?: HandoffFile | null
    queueStatus?: string
    ruling?: boolean
  } = {},
): Promise<void> {
  await mkdir(join(root, '.migrate', 'queue'), { recursive: true })
  await writeFile(
    join(root, '.migrate', 'config.toml'),
    [
      '[source]',
      `path = "${source}"`,
      'scope = "gate fixture"',
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
    { slug: 'user-management', title: 'User management', ns: 'UM', elements: ['route-get-users'] },
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
  const status = over.queueStatus ?? 'adjudicated'
  await writeFile(
    join(root, '.migrate', 'queue', 'q-open-question.md'),
    [
      '---',
      'id: q-open-question',
      'severity: moderate',
      `status: ${status}`,
      ...(status === 'adjudicated' && over.ruling !== false ? ['ruling: settled'] : []),
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
  await writeFile(
    join(root, '.migrate', 'phases.json'),
    JSON.stringify({ version: 1, phases }, null, 2),
  )
  const handoff = over.handoff === undefined ? HANDOFF : over.handoff
  if (handoff) {
    await writeFile(join(root, '.migrate', 'handoff.json'), `${JSON.stringify(handoff, null, 2)}\n`)
  }
}

const of = (violations: Violation[], gate: string): string[] =>
  violations.filter((v) => v.gate === gate).map((v) => v.message)

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'migrate-gates-'))
  source = join(root, 'legacy')
  await Bun.write(join(source, 'app.js'), '// legacy\n')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

test('a complete store passes both new gates', async () => {
  await store()
  const { violations } = await runCheck({ root })
  expect(of(violations, 'adjudication')).toEqual([])
  expect(of(violations, 'handoff')).toEqual([])
})

// --- gate 11, adjudication ---

test('gate 11 names each open queue item with its severity', async () => {
  await store({ queueStatus: 'open' })
  const { violations } = await runCheck({ root })
  const messages = of(violations, 'adjudication')
  expect(messages).toHaveLength(1)
  expect(messages[0]).toContain('q-open-question')
  expect(messages[0]).toContain('moderate')
})

// --- gate 12, handoff ---

test('gate 12 fails when handoff has never run', async () => {
  await store({ handoff: null })
  const { violations } = await runCheck({ root })
  const messages = of(violations, 'handoff')
  expect(messages).toHaveLength(1)
  expect(messages[0]).toContain('handoff.json')
})

test('gate 12 names a requirement that reached no work item', async () => {
  await store({ requirements: [req('UM-001'), req('UM-002'), req('UM-003')] })
  const { violations } = await runCheck({ root })
  const messages = of(violations, 'handoff')
  expect(messages.some((m) => m.includes('UM-003'))).toBe(true)
})

test('gate 12 names a work item entry that resolves to no requirement', async () => {
  await store({
    handoff: {
      ...HANDOFF,
      items: [{ ...HANDOFF.items[0], frs: ['UM-001', 'UM-002', 'UM-999'] } as never],
    },
  })
  const { violations } = await runCheck({ root })
  expect(of(violations, 'handoff').some((m) => m.includes('UM-999'))).toBe(true)
})

test('gate 12 names a dependsOn that resolves to no work item', async () => {
  await store({
    handoff: {
      ...HANDOFF,
      items: [{ ...HANDOFF.items[0], dependsOn: ['nowhere'] } as never],
    },
  })
  const { violations } = await runCheck({ root })
  expect(of(violations, 'handoff').some((m) => m.includes('nowhere'))).toBe(true)
})

test('gate 12 names a basis whose counts disagree with the store', async () => {
  await store({
    handoff: { ...HANDOFF, basis: { confirmed: 99, emitted: 2, order: ['user-management'] } },
  })
  const { violations } = await runCheck({ root })
  expect(of(violations, 'handoff').some((m) => m.includes('confirmed'))).toBe(true)
})

test('gate 12 counts only confirmed requirements in the basis denominator', async () => {
  // One inferred requirement: still emitted, still in a work item, but not part
  // of the confirmed denominator that coverage divides by.
  await store({
    requirements: [req('UM-001'), req('UM-002', { confidence: { kind: 'inferred' } })],
    handoff: { ...HANDOFF, basis: { confirmed: 1, emitted: 2, order: ['user-management'] } },
  })
  const { violations } = await runCheck({ root })
  expect(of(violations, 'handoff')).toEqual([])
})

// --- the phase-scope rule ---

test('both gates are skipped below their phase and fire at it', async () => {
  await store({ handoff: null, queueStatus: 'open' })

  // At --phase queue neither gate describes work the run claims to have
  // reached, so neither fires. This is what keeps mid-run checking usable.
  const mid = await runCheck({ root, phase: 'queue' })
  expect(of(mid.violations, 'adjudication')).toEqual([])
  expect(of(mid.violations, 'handoff')).toEqual([])

  // At --phase adjudicate the adjudication gate applies but handoff does not.
  const late = await runCheck({ root, phase: 'adjudicate' })
  expect(of(late.violations, 'adjudication')).toHaveLength(1)
  expect(of(late.violations, 'handoff')).toEqual([])

  // Unbounded, both apply.
  const full = await runCheck({ root })
  expect(of(full.violations, 'adjudication')).toHaveLength(1)
  expect(of(full.violations, 'handoff')).toHaveLength(1)
})

test('a store that stops at the queue still passes check --phase queue', async () => {
  // The Milestone 2 posture: no adjudication, no handoff, and the phases after
  // queue still pending. Adding two gates must not narrow this.
  await store({ handoff: null, queueStatus: 'open' })
  const phases: Record<string, unknown> = {}
  for (const p of PHASES) {
    phases[p] = {
      status: PHASES.indexOf(p) <= PHASES.indexOf('queue') ? 'done' : 'pending',
      batches:
        p === 'enumerate'
          ? [{ id: 'b-routes-1', count: 1 }]
          : p === 'extract'
            ? [{ id: 'b-extract-1', count: 2 }]
            : [],
      pending: [],
    }
  }
  await writeFile(
    join(root, '.migrate', 'phases.json'),
    JSON.stringify({ version: 1, phases }, null, 2),
  )
  const { violations } = await runCheck({ root, phase: 'queue' })
  expect(violations).toEqual([])
})
