import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanupRun, listRuns } from '../housekeeping-cmd.ts'

let home: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'magpie-home-'))
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

test('listRuns picks up active and archived runs', async () => {
  await mkdir(join(home, 'pr-1-100'))
  await mkdir(join(home, 'pr-2-200.archived-300'))
  await mkdir(join(home, 'unrelated'))
  const runs = await listRuns(home)
  const ids = runs.map((r) => r.id).sort()
  expect(ids).toEqual(['pr-1-100', 'pr-2-200.archived-300'])
})

test('listRuns picks up active and archived local runs, including dotted and dashed slugs', async () => {
  await mkdir(join(home, 'local-feature-x-100'))
  await mkdir(join(home, 'local-release-1.2_fix-200.archived-300'))
  await mkdir(join(home, 'local-detached-400'))
  await mkdir(join(home, 'local--500'))
  const runs = await listRuns(home)
  const byId = Object.fromEntries(runs.map((r) => [r.id, r.archived]))
  expect(byId).toEqual({
    'local-feature-x-100': false,
    'local-release-1.2_fix-200.archived-300': true,
    'local-detached-400': false,
  })
})

test('cleanupRun deletes the matching directory', async () => {
  await mkdir(join(home, 'pr-1-100'))
  const exit = await cleanupRun(home, 'pr-1-100')
  expect(exit).toBe(0)
  const dirs = await listRuns(home)
  expect(dirs).toEqual([])
})

test('cleanupRun on unknown id returns non-zero', async () => {
  const exit = await cleanupRun(home, 'does-not-exist')
  expect(exit).not.toBe(0)
})
