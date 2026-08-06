import { afterEach, beforeEach, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseEnv, scanLeaks, secretValues } from '../leaks.ts'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'migrate-leaks-'))
  await mkdir(join(root, '.migrate', 'queue'), { recursive: true })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

test('parseEnv handles quotes, export and comments', () => {
  const env = parseEnv('# a comment\nexport A="one two"\nB=plain\nC=\n')
  expect(env.A).toBe('one two')
  expect(env.B).toBe('plain')
  expect(env.C).toBe('')
})

test('secretValues drops empties, short values and urls', () => {
  const values = secretValues({
    MIGRATE_SOURCE_URL: 'https://legacy.example.com',
    MIGRATE_SOURCE_PASSWORD: 'hunter2-longer-secret',
    MIGRATE_SOURCE_READONLY: 'true',
    SHORT: 'abc',
    EMPTY: '',
  })
  expect(values).toEqual(['hunter2-longer-secret'])
})

test('scanLeaks finds a secret pasted into an artifact and names the variable', async () => {
  await writeFile(join(root, '.migrate', '.env'), 'MIGRATE_SOURCE_PASSWORD=hunter2-longer-secret\n')
  await writeFile(
    join(root, '.migrate', 'queue', 'q-a.md'),
    'logged in with hunter2-longer-secret\n',
  )
  const violations = await scanLeaks({ root })
  expect(violations).toHaveLength(1)
  expect(violations[0]?.message).toContain('MIGRATE_SOURCE_PASSWORD')
  expect(violations[0]?.message).toContain('q-a.md')
  expect(violations[0]?.message).not.toContain('hunter2-longer-secret')
})

test('scanLeaks passes on a clean store', async () => {
  await writeFile(join(root, '.migrate', '.env'), 'MIGRATE_SOURCE_PASSWORD=hunter2-longer-secret\n')
  await writeFile(join(root, '.migrate', 'queue', 'q-a.md'), 'observed at legacy.example.com\n')
  expect(await scanLeaks({ root })).toEqual([])
})

test('scanLeaks is a no-op with no .env file', async () => {
  expect(await scanLeaks({ root })).toEqual([])
})

test('scanLeaks reports an unreadable artifact as a violation instead of skipping it', async () => {
  await writeFile(join(root, '.migrate', '.env'), 'MIGRATE_SOURCE_PASSWORD=hunter2-longer-secret\n')
  const target = join(root, '.migrate', 'queue', 'q-a.md')
  await writeFile(target, 'nothing secret here\n')
  await chmod(target, 0o000)
  const violations = await scanLeaks({ root })
  expect(violations).toHaveLength(1)
  expect(violations[0]?.gate).toBe('leaks')
  expect(violations[0]?.message).toContain('q-a.md')
  expect(violations[0]?.message).not.toContain('hunter2-longer-secret')
})
