import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveRunDir } from '../resolve-run.ts'

let home: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'magpie-resolve-'))
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

async function makeRun(id: string, mtimeOffsetMs: number): Promise<void> {
  const path = join(home, id)
  await mkdir(join(path, 'screen'), { recursive: true })
  const now = Date.now() + mtimeOffsetMs
  await Bun.file(join(path, 'screen', 'progress.html')).write('<html></html>')
  // Touch the directory mtime by writing inside it; resolver sorts by dir mtime.
  await Bun.write(join(path, 'screen', `marker-${now}.txt`), '')
}

test('resolveRunDir returns the latest run when no id given', async () => {
  await makeRun('pr-1-1000', 0)
  await new Promise((r) => setTimeout(r, 20))
  await makeRun('pr-2-2000', 0)
  const r = await resolveRunDir(undefined, home)
  expect(r.id).toBe('pr-2-2000')
  expect(r.archived).toBe(false)
})

test('resolveRunDir picks an archived run as latest if it is newest', async () => {
  await makeRun('pr-1-1000', 0)
  await new Promise((r) => setTimeout(r, 20))
  await makeRun('pr-1-1000.archived-2000', 0)
  const r = await resolveRunDir(undefined, home)
  expect(r.id).toBe('pr-1-1000.archived-2000')
  expect(r.archived).toBe(true)
})

test('resolveRunDir resolves an explicit id within home', async () => {
  await makeRun('pr-5-9999', 0)
  const r = await resolveRunDir('pr-5-9999', home)
  expect(r.id).toBe('pr-5-9999')
  expect(r.path).toBe(join(home, 'pr-5-9999'))
  expect(r.archived).toBe(false)
})

test('resolveRunDir accepts an absolute path verbatim', async () => {
  await makeRun('pr-7-1234.archived-5678', 0)
  const path = join(home, 'pr-7-1234.archived-5678')
  const r = await resolveRunDir(path, home)
  expect(r.path).toBe(path)
  expect(r.archived).toBe(true)
})

test('resolveRunDir errors on missing id', async () => {
  await expect(resolveRunDir('nope', home)).rejects.toThrow(/not found/)
})

test('resolveRunDir errors when home has no runs', async () => {
  await expect(resolveRunDir(undefined, home)).rejects.toThrow(/No magpie runs/)
})
