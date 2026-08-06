import { afterEach, beforeEach, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeConfig } from '../config.ts'
import { storePaths } from '../paths.ts'
import { loadPhases, recordBatch, setPhaseStatus } from '../phases.ts'
import { loadQueue } from '../queue.ts'
import { runReset } from '../reset-cmd.ts'
import { runStatus } from '../status-cmd.ts'
import { readRows, writeRows } from '../store.ts'
import type { Capability, Census, Delta, Element, Requirement } from '../types.ts'

let root: string
let source: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'migrate-status-'))
  source = join(root, 'legacy')
  await mkdir(join(root, '.migrate', 'queue'), { recursive: true })
  await mkdir(source, { recursive: true })
  await writeConfig(root, { sourcePath: source, scope: 'all', targetName: 'newapp' })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const ELEMENT: Element = {
  id: 'route-a',
  surface: 'routes',
  element: 'GET /a',
  found_by: ['code'],
  disposition: { kind: 'mapped', fr: 'UM-001' },
  refs: [],
  lens: 'code',
  batch: 'b-1',
  notes: '',
}

const REQUIREMENT: Requirement = {
  id: 'UM-001',
  cap: 'user-management',
  requirement: 'List',
  actors: '-',
  objects: '-',
  rules: '-',
  origin: 'intended',
  confidence: { kind: 'confirmed' },
  citations: [{ kind: 'ledger', id: 'route-a' }],
  parity: { kind: 'rubric', level: 'high' },
  batch: 'b-1',
}

const LENS_CENSUS: Census = {
  kind: 'lens',
  surface: 'routes',
  phase: 'enumerate',
  directions: { code: 1 },
  total: 1,
  in_ledger: 1,
  added: 0,
  skipped: [],
  queued: [],
  batch: 'b-1',
}

const ATTR_CENSUS: Census = {
  kind: 'attribute',
  surface: 'tables',
  subject: 'table-a',
  directions: { ddl: 3 },
  total: 3,
  behavioral: 1,
  explained: 1,
  queued: [],
  batch: 'b-2',
}

const CAPABILITY: Capability = {
  slug: 'user-management',
  title: 'User management',
  ns: 'UM',
  elements: ['route-a'],
}

const DELTA: Delta = {
  id: 'delta-1',
  scope: 'user-management',
  rationale: 'legacy quirk not worth replicating',
  parity_exclusion: 'silent 500 on double-submit',
  validation: 'manual review',
  owner_signed: 'jane@example.com',
  batch: 'b-1',
}

const QUEUE_ITEM = `---
id: q-invoice-batch-scope
severity: moderate
status: open
---

## Evidence

Route POST /api/invoice/batch found in InvoiceController.cs:215-240.

## Options

(a) Replicate as-is. (b) Harden it. (c) Mark out of scope.

## Recommendation

Recommend (c); three invocations in six months.
`

async function writeQueueItem(root: string): Promise<string> {
  const path = join(storePaths(root).queueDir, 'q-invoice-batch-scope.md')
  await writeFile(path, QUEUE_ITEM)
  return path
}

test('reset extract clears requirements and returns dispositions to unaccounted', async () => {
  const p = storePaths(root)
  await writeRows(p.elements, [ELEMENT], source)
  await writeRows(p.requirements, [REQUIREMENT], source)
  await writeRows(p.census, [LENS_CENSUS, ATTR_CENSUS], source)
  await setPhaseStatus(root, 'extract', 'done', source)

  expect(await runReset({ root, phase: 'extract' })).toBe(0)

  expect(await readRows<Requirement>(p.requirements)).toEqual([])
  const elements = await readRows<Element>(p.elements)
  expect(elements[0]?.disposition).toEqual({ kind: 'unaccounted' })
  const census = await readRows<Census>(p.census)
  expect(census.map((c) => c.kind)).toEqual(['lens'])
  expect((await loadPhases(root)).extract.status).toBe('pending')
})

test('reset enumerate clears elements and lens census but leaves attribute census', async () => {
  const p = storePaths(root)
  await writeRows(p.elements, [ELEMENT], source)
  await writeRows(p.census, [LENS_CENSUS, ATTR_CENSUS], source)
  await recordBatch(root, 'enumerate', { id: 'b-1', count: 1 }, source)

  expect(await runReset({ root, phase: 'enumerate' })).toBe(0)

  expect(await readRows(p.elements)).toEqual([])
  expect((await readRows<Census>(p.census)).map((c) => c.kind)).toEqual(['attribute'])
  const phases = await loadPhases(root)
  expect(phases.enumerate.status).toBe('pending')
  expect(phases.enumerate.batches).toEqual([])
})

test('reset rejects an unknown phase', async () => {
  expect(await runReset({ root, phase: 'seams' })).toBe(2)
})

test('reset seam clears capabilities and seam files but leaves elements and requirements alone', async () => {
  const p = storePaths(root)
  await writeRows(p.elements, [ELEMENT], source)
  await writeRows(p.requirements, [REQUIREMENT], source)
  await writeRows(p.capabilities, [CAPABILITY], source)
  await writeFile(p.seamJson, '{"capabilities":[]}\n')
  await writeFile(p.seamMd, '# Seam\n')
  await setPhaseStatus(root, 'seam', 'done', source)

  expect(await runReset({ root, phase: 'seam' })).toBe(0)

  expect(await readRows<Capability>(p.capabilities)).toEqual([])
  expect(existsSync(p.seamJson)).toBe(false)
  expect(existsSync(p.seamMd)).toBe(false)
  expect(await readRows<Element>(p.elements)).toEqual([ELEMENT])
  expect(await readRows<Requirement>(p.requirements)).toEqual([REQUIREMENT])
  expect((await loadPhases(root)).seam.status).toBe('pending')
})

test('reset parity clears deltas and nulls every requirement parity but leaves elements alone', async () => {
  const p = storePaths(root)
  const other: Requirement = {
    ...REQUIREMENT,
    id: 'UM-002',
    parity: { kind: 'golden-master', ref: 'gm-1' },
  }
  await writeRows(p.elements, [ELEMENT], source)
  await writeRows(p.requirements, [REQUIREMENT, other], source)
  await writeRows(p.deltas, [DELTA], source)
  await setPhaseStatus(root, 'parity', 'done', source)

  expect(await runReset({ root, phase: 'parity' })).toBe(0)

  expect(await readRows<Delta>(p.deltas)).toEqual([])
  const reqs = await readRows<Requirement>(p.requirements)
  expect(reqs.map((r) => r.parity)).toEqual([null, null])
  expect(await readRows<Element>(p.elements)).toEqual([ELEMENT])
  expect((await loadPhases(root)).parity.status).toBe('pending')
})

test('reset on a phase that owns no rows resets only its state, touching no store file', async () => {
  const p = storePaths(root)
  await writeRows(p.elements, [ELEMENT], source)
  await writeRows(p.requirements, [REQUIREMENT], source)
  await writeRows(p.capabilities, [CAPABILITY], source)
  await writeRows(p.deltas, [DELTA], source)
  await writeRows(p.census, [LENS_CENSUS, ATTR_CENSUS], source)
  await recordBatch(root, 'probe', { id: 'b-1', count: 1 }, source)

  expect(await runReset({ root, phase: 'probe' })).toBe(0)

  expect(await readRows<Element>(p.elements)).toEqual([ELEMENT])
  expect(await readRows<Requirement>(p.requirements)).toEqual([REQUIREMENT])
  expect(await readRows<Capability>(p.capabilities)).toEqual([CAPABILITY])
  expect(await readRows<Delta>(p.deltas)).toEqual([DELTA])
  expect((await readRows<Census>(p.census)).map((c) => c.kind)).toEqual(['lens', 'attribute'])
  const phases = await loadPhases(root)
  expect(phases.probe.status).toBe('pending')
  expect(phases.probe.batches).toEqual([])
})

test('reset never touches queue items, regardless of which phase is reset', async () => {
  const queuePath = await writeQueueItem(root)
  const p = storePaths(root)
  await writeRows(p.elements, [ELEMENT], source)
  await writeRows(p.requirements, [REQUIREMENT], source)
  await writeRows(p.capabilities, [CAPABILITY], source)
  await writeRows(p.deltas, [DELTA], source)
  await writeRows(p.census, [LENS_CENSUS, ATTR_CENSUS], source)

  for (const phase of ['enumerate', 'seam', 'extract', 'parity', 'probe'] as const) {
    expect(await runReset({ root, phase })).toBe(0)
  }

  expect(existsSync(queuePath)).toBe(true)
  const { items, errors } = await loadQueue(p.queueDir)
  expect(errors).toEqual([])
  expect(items.map((i) => i.id)).toEqual(['q-invoice-batch-scope'])
})

async function captureStdout(fn: () => Promise<number>): Promise<{ code: number; text: string }> {
  const out: string[] = []
  const original = process.stdout.write.bind(process.stdout)
  process.stdout.write = ((s: string) => {
    out.push(s)
    return true
  }) as typeof process.stdout.write
  try {
    const code = await fn()
    return { code, text: out.join('') }
  } finally {
    process.stdout.write = original
  }
}

test('status names the first non-done phase and its last batch as the resume pointer', async () => {
  const p = storePaths(root)
  await writeRows(p.elements, [ELEMENT], source)
  await writeRows(p.requirements, [REQUIREMENT], source)
  await setPhaseStatus(root, 'probe', 'done', source)
  await recordBatch(root, 'enumerate', { id: 'b-1', count: 1 }, source)
  await setPhaseStatus(root, 'enumerate', 'done', source)
  await recordBatch(root, 'seam', { id: 'b-2', count: 2 }, source)

  const { code, text } = await captureStdout(() => runStatus({ root }))

  expect(code).toBe(0)
  expect(text).toContain('probe       done')
  expect(text).toContain('enumerate   done (1 batch(es))')
  expect(text).toContain('seam        running (1 batch(es))')
  expect(text).toContain('1 requirement(s), 1 element(s)')
  expect(text).toContain('resume: seam, last batch b-2 (2 row(s))')
})

test('status reports all phases done when nothing is left to resume', async () => {
  const phases = await loadPhases(root)
  for (const phase of Object.keys(phases) as (keyof typeof phases)[]) {
    await setPhaseStatus(root, phase, 'done', source)
  }

  const { code, text } = await captureStdout(() => runStatus({ root }))

  expect(code).toBe(0)
  expect(text).toContain('resume: all phases done')
})
