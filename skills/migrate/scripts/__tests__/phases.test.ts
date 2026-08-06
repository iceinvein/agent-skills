import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isPhase, loadPhases, recordBatch, setPhaseStatus } from '../phases.ts'

let root: string
const NO_SOURCE = '/nonexistent-source'

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'migrate-phases-'))
  await mkdir(join(root, '.migrate'), { recursive: true })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

test('loadPhases defaults every phase to pending', async () => {
  const state = await loadPhases(root)
  expect(state.enumerate.status).toBe('pending')
  expect(state.handoff.batches).toEqual([])
})

test('recordBatch appends and flips the phase to running', async () => {
  await recordBatch(root, 'enumerate', { id: 'b-routes-code-001', count: 10 }, NO_SOURCE)
  await recordBatch(root, 'enumerate', { id: 'b-routes-code-002', count: 7 }, NO_SOURCE)
  const state = await loadPhases(root)
  expect(state.enumerate.status).toBe('running')
  expect(state.enumerate.batches.map((b) => b.id)).toEqual([
    'b-routes-code-001',
    'b-routes-code-002',
  ])
})

test('recordBatch is idempotent on a repeated batch id', async () => {
  await recordBatch(root, 'enumerate', { id: 'b-1', count: 10 }, NO_SOURCE)
  await recordBatch(root, 'enumerate', { id: 'b-1', count: 10 }, NO_SOURCE)
  const state = await loadPhases(root)
  expect(state.enumerate.batches).toHaveLength(1)
})

test('recordBatch does not reopen a done phase', async () => {
  await setPhaseStatus(root, 'enumerate', 'done', NO_SOURCE)
  await recordBatch(root, 'enumerate', { id: 'b-late', count: 1 }, NO_SOURCE)
  const state = await loadPhases(root)
  expect(state.enumerate.status).toBe('done')
  expect(state.enumerate.batches).toHaveLength(1)
})

test('isPhase rejects an unknown phase name', () => {
  expect(isPhase('seam')).toBe(true)
  expect(isPhase('seams')).toBe(false)
})
