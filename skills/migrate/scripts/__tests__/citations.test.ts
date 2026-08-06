import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveCitations } from '../citations.ts'
import type { Requirement } from '../types.ts'

let source: string

beforeEach(async () => {
  source = await mkdtemp(join(tmpdir(), 'migrate-src-'))
  await mkdir(join(source, 'Controllers'), { recursive: true })
  await writeFile(
    join(source, 'Controllers', 'Auth.cs'),
    Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n'),
  )
})

afterEach(async () => {
  await rm(source, { recursive: true, force: true })
})

function req(citations: Requirement['citations']): Requirement {
  return {
    id: 'UM-001',
    cap: 'user-management',
    requirement: 'User logs in',
    actors: 'User',
    objects: 'Credentials',
    rules: '-',
    origin: 'intended',
    confidence: { kind: 'confirmed' },
    citations,
    parity: { kind: 'rubric', level: 'high' },
    batch: 'b-1',
  }
}

test('a src citation inside the file passes', async () => {
  const v = await resolveCitations(
    [req([{ kind: 'src', path: 'Controllers/Auth.cs', lines: [20, 35] }])],
    source,
  )
  expect(v).toEqual([])
})

test('a src citation to a missing file is a violation naming the path', async () => {
  const v = await resolveCitations([req([{ kind: 'src', path: 'Controllers/Ghost.cs' }])], source)
  expect(v).toHaveLength(1)
  expect(v[0]?.message).toContain('Controllers/Ghost.cs')
  expect(v[0]?.gate).toBe('citations')
})

test('a line range past the end of the file is a violation', async () => {
  const v = await resolveCitations(
    [req([{ kind: 'src', path: 'Controllers/Auth.cs', lines: [45, 900] }])],
    source,
  )
  expect(v).toHaveLength(1)
  expect(v[0]?.message).toContain('900')
  expect(v[0]?.message).toContain('50')
})

test('a ledger citation is not resolved against the source tree', async () => {
  const v = await resolveCitations([req([{ kind: 'ledger', id: 'route-post-api-login' }])], source)
  expect(v).toEqual([])
})

test('a citation escaping the source root is a violation', async () => {
  const v = await resolveCitations([req([{ kind: 'src', path: '../outside.cs' }])], source)
  expect(v).toHaveLength(1)
  expect(v[0]?.message).toContain('outside the source tree')
})
