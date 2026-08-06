import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeConfig } from '../config.ts'
import { runImport } from '../import-cmd.ts'
import { storePaths } from '../paths.ts'
import { loadPhases } from '../phases.ts'
import { readRows } from '../store.ts'
import type { Element } from '../types.ts'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'migrate-import-'))
  await mkdir(join(root, '.migrate'), { recursive: true })
  await writeConfig(root, { sourcePath: join(root, 'legacy'), scope: 'all', targetName: 'newapp' })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function batch(rows: unknown[], phase = 'enumerate', id = 'b-1'): Promise<string> {
  const path = join(root, 'batch.json')
  await writeFile(path, JSON.stringify({ batch: id, phase, rows }))
  return path
}

const ELEMENT = {
  id: 'route-get-api-users',
  surface: 'routes',
  element: 'GET /api/users',
  found_by: ['code'],
  disposition: { kind: 'unaccounted' },
  refs: [{ kind: 'src', path: 'Controllers/UsersController.cs', lines: [42, 58] }],
  lens: 'code',
  notes: '',
}

test('a valid element batch lands in the store and records the batch', async () => {
  const code = await runImport({ root, kind: 'elements', batchFile: await batch([ELEMENT]) })
  expect(code).toBe(0)
  const rows = await readRows<Element>(storePaths(root).elements)
  expect(rows).toHaveLength(1)
  expect(rows[0]?.batch).toBe('b-1')
  const phases = await loadPhases(root)
  expect(phases.enumerate.batches.map((b) => b.id)).toEqual(['b-1'])
})

test('an element whose id does not match its surface is rejected', async () => {
  const bad = { ...ELEMENT, id: 'table-users' }
  const code = await runImport({ root, kind: 'elements', batchFile: await batch([bad]) })
  expect(code).toBe(1)
  expect(await readRows(storePaths(root).elements)).toEqual([])
})

test('an element on an undeclared surface is rejected', async () => {
  const bad = { ...ELEMENT, id: 'gizmo-a', surface: 'gizmos' }
  const code = await runImport({ root, kind: 'elements', batchFile: await batch([bad]) })
  expect(code).toBe(1)
})

test('a batch is all-or-nothing: one bad row writes none', async () => {
  const bad = { ...ELEMENT, id: 'route-b', found_by: [] }
  const code = await runImport({ root, kind: 'elements', batchFile: await batch([ELEMENT, bad]) })
  expect(code).toBe(1)
  expect(await readRows(storePaths(root).elements)).toEqual([])
})

test('re-importing the same batch does not duplicate rows', async () => {
  await runImport({ root, kind: 'elements', batchFile: await batch([ELEMENT]) })
  await runImport({ root, kind: 'elements', batchFile: await batch([ELEMENT]) })
  expect(await readRows(storePaths(root).elements)).toHaveLength(1)
})

test('a requirement with no citations is rejected', async () => {
  const req = {
    id: 'UM-001',
    cap: 'user-management',
    requirement: 'User logs in',
    actors: 'User',
    objects: 'Credentials',
    rules: '-',
    origin: 'intended',
    confidence: { kind: 'confirmed' },
    citations: [],
    parity: { kind: 'rubric', level: 'high' },
  }
  const code = await runImport({ root, kind: 'reqs', batchFile: await batch([req], 'extract') })
  expect(code).toBe(1)
})

test('a sub-high rubric parity without a queue id is rejected', async () => {
  const req = {
    id: 'UM-002',
    cap: 'user-management',
    requirement: 'User logs out',
    actors: 'User',
    objects: 'Session',
    rules: '-',
    origin: 'intended',
    confidence: { kind: 'confirmed' },
    citations: [{ kind: 'ledger', id: 'route-get-api-users' }],
    parity: { kind: 'rubric', level: 'moderate' },
  }
  const code = await runImport({ root, kind: 'reqs', batchFile: await batch([req], 'parity') })
  expect(code).toBe(1)
})
