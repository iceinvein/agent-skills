import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCheck } from '../check.ts'

let root: string
let source: string

async function init(): Promise<void> {
  const { runInit } = await import('../init-cmd.ts')
  const code = await runInit({
    root,
    sourcePath: source,
    scope: 'run-state fixture',
    targetName: 'target',
  })
  expect(code).toBe(0)
}

async function setPhases(states: Record<string, unknown>): Promise<void> {
  const all: Record<string, unknown> = {}
  for (const p of [
    'probe',
    'enumerate',
    'seam',
    'extract',
    'parity',
    'queue',
    'adjudicate',
    'handoff',
  ]) {
    all[p] = { status: 'pending', batches: [], pending: [], ...(states[p] as object) }
  }
  await writeFile(
    join(root, '.migrate', 'phases.json'),
    JSON.stringify({ version: 1, phases: all }),
  )
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'migrate-runstate-'))
  source = join(root, 'legacy')
  await Bun.write(join(source, 'app.js'), '// legacy\n')
  await init()
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

test('a store nobody worked in fails run-state once per phase', async () => {
  const result = await runCheck({ root })
  const runState = result.violations.filter((v) => v.gate === 'run-state')
  expect(runState.length).toBe(8)
  expect(runState.some((v) => v.message.includes('probe is pending'))).toBe(true)
  expect(runState.some((v) => v.message.includes('handoff is pending'))).toBe(true)
})

test('--phase bounds run-state at the named phase', async () => {
  await setPhases({ probe: { status: 'done' } })
  const result = await runCheck({ root, phase: 'probe' })
  expect(result.violations.filter((v) => v.gate === 'run-state').length).toBe(0)
})

test('--phase still fails when a phase at or below the terminus is short of done', async () => {
  await setPhases({ probe: { status: 'done' }, enumerate: { status: 'running' } })
  const result = await runCheck({ root, phase: 'enumerate' })
  const runState = result.violations.filter((v) => v.gate === 'run-state')
  expect(runState.length).toBe(1)
  expect(runState[0]?.message).toContain('enumerate is running')
})

test('a phase marked done above a pending predecessor is named', async () => {
  await setPhases({ seam: { status: 'done' } })
  const result = await runCheck({ root })
  const runState = result.violations.filter((v) => v.gate === 'run-state')
  expect(
    runState.some((v) => v.message.includes('seam is done while enumerate is still pending')),
  ).toBe(true)
})

test('a lens census naming an uncommitted batch is named', async () => {
  await setPhases({
    probe: { status: 'done' },
    enumerate: { status: 'done', batches: [{ id: 'b-other-001', count: 1 }] },
  })
  await writeFile(
    join(root, '.migrate', 'census.jsonl'),
    `${JSON.stringify({
      kind: 'lens',
      surface: 'routes',
      phase: 'enumerate',
      directions: {
        code: { count: 0, evidence: 'rg -n "app.(get|post)" app.js' },
        nav: { count: 0, evidence: 'manual review of route registrations' },
      },
      total: 0,
      in_ledger: 0,
      added: 0,
      skipped: [],
      queued: [],
      batch: 'b-routes-census-001',
    })}\n`,
  )
  const result = await runCheck({ root, phase: 'enumerate' })
  const runState = result.violations.filter((v) => v.gate === 'run-state')
  expect(runState.some((v) => v.message.includes('b-routes-census-001'))).toBe(true)
})

test('citations run by default and can be turned off', async () => {
  await writeFile(
    join(root, '.migrate', 'capabilities.jsonl'),
    `${JSON.stringify({ slug: 'core', title: 'Core', ns: 'core', elements: [] })}\n`,
  )
  await writeFile(
    join(root, '.migrate', 'requirements.jsonl'),
    `${JSON.stringify({
      id: 'UM-001',
      cap: 'core',
      requirement: 'r',
      actors: 'a',
      objects: 'o',
      rules: 'x',
      origin: 'intended',
      confidence: { kind: 'confirmed' },
      citations: [{ kind: 'src', path: 'Gone.cs' }],
      parity: { kind: 'rubric', level: 'high' },
      batch: 'b-001',
    })}\n`,
  )
  const on = await runCheck({ root })
  expect(on.violations.some((v) => v.gate === 'citations')).toBe(true)
  const off = await runCheck({ root, citations: false })
  expect(off.violations.some((v) => v.gate === 'citations')).toBe(false)
})
