import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildIncrementalContext, findPreviousRun } from '../incremental.ts'

let home: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'magpie-incremental-home-'))
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

async function seedRun(id: string, prJson: Record<string, unknown>): Promise<string> {
  const dir = join(home, id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'pr.json'), JSON.stringify(prJson))
  return dir
}

test('findPreviousRun returns null when no prior runs exist', async () => {
  const result = await findPreviousRun(42, join(home, 'pr-42-100'), home)
  expect(result).toBeNull()
})

test('findPreviousRun returns the most recent prior run for the PR', async () => {
  await seedRun('pr-42-100', { headRefOid: 'aaa' })
  await seedRun('pr-42-200', { headRefOid: 'bbb' })
  const currentRun = join(home, 'pr-42-300')
  const result = await findPreviousRun(42, currentRun, home)
  expect(result?.runId).toBe('pr-42-200')
})

test('findPreviousRun excludes the current run from candidates', async () => {
  await seedRun('pr-42-100', { headRefOid: 'aaa' })
  const currentRun = join(home, 'pr-42-200')
  await mkdir(currentRun, { recursive: true })
  const result = await findPreviousRun(42, currentRun, home)
  expect(result?.runId).toBe('pr-42-100')
})

test('findPreviousRun ignores other PR numbers', async () => {
  await seedRun('pr-99-100', { headRefOid: 'other' })
  const result = await findPreviousRun(42, join(home, 'pr-42-200'), home)
  expect(result).toBeNull()
})

test('findPreviousRun matches archived runs', async () => {
  await seedRun('pr-42-100.archived-200', { headRefOid: 'old' })
  const result = await findPreviousRun(42, join(home, 'pr-42-300'), home)
  expect(result?.runId).toBe('pr-42-100.archived-200')
})

test('findPreviousRun skips candidates with missing pr.json', async () => {
  await mkdir(join(home, 'pr-42-100'), { recursive: true })
  await seedRun('pr-42-50', { headRefOid: 'older' })
  const result = await findPreviousRun(42, join(home, 'pr-42-200'), home)
  expect(result?.runId).toBe('pr-42-50')
})

test('buildIncrementalContext detects new commits', () => {
  const ctx = buildIncrementalContext(
    { headRefOid: 'newsha' },
    { runId: 'pr-42-100', prJson: { headRefOid: 'oldsha' } },
  )
  expect(ctx?.previousSha).toBe('oldsha')
  expect(ctx?.currentSha).toBe('newsha')
  expect(ctx?.sameSha).toBe(false)
})

test('buildIncrementalContext flags same-sha re-review', () => {
  const ctx = buildIncrementalContext(
    { headRefOid: 'samesha' },
    { runId: 'pr-42-100', prJson: { headRefOid: 'samesha' } },
  )
  expect(ctx?.sameSha).toBe(true)
})

test('buildIncrementalContext returns null when either sha is missing', () => {
  const noPrev = buildIncrementalContext({ headRefOid: 'new' }, { runId: 'x', prJson: {} })
  expect(noPrev).toBeNull()
  const noCurr = buildIncrementalContext({}, { runId: 'x', prJson: { headRefOid: 'a' } })
  expect(noCurr).toBeNull()
})
