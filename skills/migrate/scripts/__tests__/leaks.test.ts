import { afterEach, beforeEach, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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

async function git(args: string[], cwd: string): Promise<void> {
  const proc = Bun.spawn(['git', ...args], { cwd, stdout: 'ignore', stderr: 'ignore' })
  const code = await proc.exited
  if (code !== 0) throw new Error(`git ${args.join(' ')} failed with exit code ${code}`)
}

async function initRepo(cwd: string): Promise<void> {
  await git(['init', '-q'], cwd)
  await git(['config', 'user.email', 'test@example.com'], cwd)
  await git(['config', 'user.name', 'Test'], cwd)
  await git(['config', 'commit.gpgsign', 'false'], cwd)
}

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

test('scanLeaks reports one violation per file for a value shared by two variables, naming both', async () => {
  await writeFile(
    join(root, '.migrate', '.env'),
    'MIGRATE_SOURCE_PASSWORD=hunter2-longer-secret\nMIGRATE_SOURCE_PASSWORD_RO=hunter2-longer-secret\n',
  )
  await writeFile(
    join(root, '.migrate', 'queue', 'q-a.md'),
    'logged in with hunter2-longer-secret\n',
  )
  const violations = await scanLeaks({ root })
  expect(violations).toHaveLength(1)
  expect(violations[0]?.message).toContain('MIGRATE_SOURCE_PASSWORD_RO')
  expect(violations[0]?.message).toContain('MIGRATE_SOURCE_PASSWORD')
  expect(violations[0]?.message).not.toContain('hunter2-longer-secret')
})

test('scanLeaks never puts a secret value on the git subprocess argument list', async () => {
  await writeFile(join(root, '.migrate', '.env'), 'MIGRATE_SOURCE_PASSWORD=hunter2-longer-secret\n')
  await mkdir(join(root, '.git'))
  const capturePath = join(root, 'argv-capture.log')
  const stubPath = join(root, 'git-stub.sh')
  await writeFile(stubPath, `#!/bin/sh\necho "$@" >> ${JSON.stringify(capturePath)}\n`)
  await chmod(stubPath, 0o755)

  await scanLeaks({ root, gitBin: stubPath })

  const captured = await readFile(capturePath, 'utf8').catch(() => '')
  expect(captured.length).toBeGreaterThan(0)
  expect(captured).not.toContain('hunter2-longer-secret')
})

test('scanLeaks finds a secret spanning a chunk boundary in the git stub output', async () => {
  // The stub writes the secret in two separate stdout writes with a pause in
  // between, so the parent's stream reads them as two separate chunks with
  // the secret split across the boundary. This exercises the carry-over
  // logic in findInStream rather than relying on how a real git process
  // happens to buffer its output.
  const secret = 'hunter2-longer-secret'
  await writeFile(join(root, '.migrate', '.env'), `MIGRATE_SOURCE_PASSWORD=${secret}\n`)
  await mkdir(join(root, '.git'))
  const stubPath = join(root, 'git-stub-split.ts')
  const mid = Math.floor(secret.length / 2)
  await writeFile(
    stubPath,
    [
      '#!/usr/bin/env bun',
      `process.stdout.write(${JSON.stringify(secret.slice(0, mid))})`,
      'await new Promise((resolve) => setTimeout(resolve, 50))',
      `process.stdout.write(${JSON.stringify(secret.slice(mid))})`,
      '',
    ].join('\n'),
  )
  await chmod(stubPath, 0o755)

  const violations = await scanLeaks({ root, gitBin: stubPath })
  expect(violations).toHaveLength(1)
  expect(violations[0]?.message).toContain('MIGRATE_SOURCE_PASSWORD')
  expect(violations[0]?.message).toContain('git history')
})

test('scanLeaks finds a secret that exists only in git history, not in the working tree', async () => {
  await writeFile(join(root, '.migrate', '.env'), 'MIGRATE_SOURCE_PASSWORD=hunter2-longer-secret\n')
  await initRepo(root)
  const notes = join(root, 'notes.txt')
  await writeFile(notes, 'logged in with hunter2-longer-secret\n')
  await git(['add', 'notes.txt'], root)
  await git(['commit', '-q', '-m', 'add notes'], root)
  await writeFile(notes, 'logged in fine\n')
  await git(['add', 'notes.txt'], root)
  await git(['commit', '-q', '-m', 'redact notes'], root)

  const violations = await scanLeaks({ root })
  expect(violations).toHaveLength(1)
  expect(violations[0]?.gate).toBe('leaks')
  expect(violations[0]?.message).toContain('MIGRATE_SOURCE_PASSWORD')
  expect(violations[0]?.message).toContain('git history')
  expect(violations[0]?.message).not.toContain('hunter2-longer-secret')
})

test('scanLeaks does not attempt to run git when there is no .git directory', async () => {
  await writeFile(join(root, '.migrate', '.env'), 'MIGRATE_SOURCE_PASSWORD=hunter2-longer-secret\n')
  const violations = await scanLeaks({ root, gitBin: join(root, 'no-such-git-binary') })
  expect(violations).toEqual([])
})

test('scanLeaks reports a violation when git cannot be run, instead of crashing', async () => {
  await writeFile(join(root, '.migrate', '.env'), 'MIGRATE_SOURCE_PASSWORD=hunter2-longer-secret\n')
  await mkdir(join(root, '.git'))
  const violations = await scanLeaks({ root, gitBin: join(root, 'no-such-git-binary') })
  expect(violations).toHaveLength(1)
  expect(violations[0]?.gate).toBe('leaks')
  expect(violations[0]?.message).not.toContain('hunter2-longer-secret')
})
