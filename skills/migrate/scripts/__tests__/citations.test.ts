import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
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

test('an inverted line range is a violation', async () => {
  const v = await resolveCitations(
    [req([{ kind: 'src', path: 'Controllers/Auth.cs', lines: [30, 10] }])],
    source,
  )
  expect(v).toHaveLength(1)
  expect(v[0]?.gate).toBe('citations')
})

test('a symlink inside source tree pointing outside is a violation', async () => {
  const outside = await mkdtemp(join(tmpdir(), 'migrate-out-'))
  try {
    const outside_file = join(outside, 'outside.cs')
    await writeFile(outside_file, 'outside content')
    const link_path = join(source, 'link.cs')
    try {
      await symlink(outside_file, link_path)
    } catch {
      // Symlinks not supported on this platform, skip
      return
    }
    const v = await resolveCitations([req([{ kind: 'src', path: 'link.cs' }])], source)
    expect(v).toHaveLength(1)
    expect(v[0]?.message).toContain('outside the source tree')
  } finally {
    await rm(outside, { recursive: true, force: true })
  }
})

test('an absolute path is rejected', async () => {
  const v = await resolveCitations([req([{ kind: 'src', path: '/absolute/path.cs' }])], source)
  expect(v).toHaveLength(1)
  expect(v[0]?.gate).toBe('citations')
})

test('a file with no trailing newline passes', async () => {
  await writeFile(join(source, 'NoNewline.cs'), 'line 1\nline 2')
  const v = await resolveCitations(
    [req([{ kind: 'src', path: 'NoNewline.cs', lines: [1, 2] }])],
    source,
  )
  expect(v).toEqual([])
})

test('a path with spaces passes', async () => {
  await writeFile(join(source, 'File With Spaces.cs'), 'line 1')
  const v = await resolveCitations(
    [req([{ kind: 'src', path: 'File With Spaces.cs', lines: [1, 1] }])],
    source,
  )
  expect(v).toEqual([])
})

test('a path with unicode passes', async () => {
  await writeFile(join(source, '文件.cs'), 'line 1')
  const v = await resolveCitations([req([{ kind: 'src', path: '文件.cs', lines: [1, 1] }])], source)
  expect(v).toEqual([])
})

test('a path with leading ./ passes', async () => {
  const v = await resolveCitations(
    [req([{ kind: 'src', path: './Controllers/Auth.cs', lines: [1, 10] }])],
    source,
  )
  expect(v).toEqual([])
})

test('a one-line file cited [1,1] passes', async () => {
  await writeFile(join(source, 'OneLine.cs'), 'single line')
  const v = await resolveCitations(
    [req([{ kind: 'src', path: 'OneLine.cs', lines: [1, 1] }])],
    source,
  )
  expect(v).toEqual([])
})

test('a src ref with no lines passes', async () => {
  const v = await resolveCitations([req([{ kind: 'src', path: 'Controllers/Auth.cs' }])], source)
  expect(v).toEqual([])
})
