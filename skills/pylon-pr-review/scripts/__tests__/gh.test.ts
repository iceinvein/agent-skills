import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fetchPr } from '../gh.ts'

const FAKE_GH = new URL('../../fixtures/fake-gh.sh', import.meta.url).pathname

let runDir: string

beforeEach(async () => {
  runDir = await mkdtemp(join(tmpdir(), 'prskill-gh-'))
})

afterEach(async () => {
  await rm(runDir, { recursive: true, force: true })
})

test('fetchPr writes pr.json and diff.patch', async () => {
  const result = await fetchPr({ ghBin: FAKE_GH, prNumber: 1234, runDir })
  expect(result.ok).toBe(true)
  const prJson = JSON.parse(await readFile(join(runDir, 'pr.json'), 'utf8'))
  expect(prJson.number).toBe(1234)
  expect(prJson.headRefName).toBe('feature-x')
  const diff = await readFile(join(runDir, 'diff.patch'), 'utf8')
  expect(diff).toContain('export const x = 2')
})

test('fetchPr returns ok=false when gh exits non-zero', async () => {
  const result = await fetchPr({
    ghBin: '/usr/bin/false',
    prNumber: 1234,
    runDir,
  })
  expect(result.ok).toBe(false)
  if (!result.ok) {
    expect(result.error).toBeDefined()
  }
})
