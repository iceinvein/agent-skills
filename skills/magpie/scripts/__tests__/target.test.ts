import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readTarget, reviewRoot, writeTarget } from '../target.ts'

let runDir: string

beforeEach(async () => {
  runDir = await mkdtemp(join(tmpdir(), 'magpie-target-'))
})

afterEach(async () => {
  await rm(runDir, { recursive: true, force: true })
})

test('a run without target.json reads as PR mode rooted at its worktree', async () => {
  expect(await readTarget(runDir)).toEqual({ mode: 'pr', root: join(runDir, 'worktree') })
})

test('a written local target reads back', async () => {
  await writeTarget(runDir, { mode: 'local', root: '/x' })
  expect(await readTarget(runDir)).toEqual({ mode: 'local', root: '/x' })
})

test('writeTarget writes two-space JSON with a trailing newline', async () => {
  await writeTarget(runDir, { mode: 'local', root: '/x' })
  expect(await readFile(join(runDir, 'target.json'), 'utf8')).toBe(
    '{\n  "mode": "local",\n  "root": "/x"\n}\n',
  )
})

test('reviewRoot returns the root named in target.json', async () => {
  await writeTarget(runDir, { mode: 'local', root: '/repo' })
  expect(await reviewRoot(runDir)).toBe('/repo')
})

test('an unknown mode throws naming target.json', async () => {
  await writeFile(join(runDir, 'target.json'), JSON.stringify({ mode: 'other', root: '/x' }))
  await expect(readTarget(runDir)).rejects.toThrow(/target\.json.*mode/)
})

test('a non-string root throws naming target.json', async () => {
  await writeFile(join(runDir, 'target.json'), JSON.stringify({ mode: 'local', root: 7 }))
  await expect(readTarget(runDir)).rejects.toThrow(/target\.json.*root/)
})

test('an empty root throws as not absolute', async () => {
  await writeFile(join(runDir, 'target.json'), JSON.stringify({ mode: 'local', root: '' }))
  await expect(readTarget(runDir)).rejects.toThrow(
    `${join(runDir, 'target.json')}: root must be an absolute path`,
  )
})

test('a relative root throws as not absolute', async () => {
  await writeFile(join(runDir, 'target.json'), JSON.stringify({ mode: 'local', root: 'repo' }))
  await expect(readTarget(runDir)).rejects.toThrow(
    `${join(runDir, 'target.json')}: root must be an absolute path`,
  )
})

test('a target.json that cannot be read for a reason other than absence rejects', async () => {
  await mkdir(join(runDir, 'target.json'))
  await expect(readTarget(runDir)).rejects.toThrow(/EISDIR/)
})

test('unparseable target.json throws naming the file', async () => {
  await writeFile(join(runDir, 'target.json'), 'not json')
  await expect(readTarget(runDir)).rejects.toThrow(/target\.json/)
})
