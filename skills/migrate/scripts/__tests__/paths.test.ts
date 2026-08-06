import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertNotUnderSource, findStoreRoot, storePaths } from '../paths.ts'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'migrate-paths-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

test('findStoreRoot walks up to the directory holding .migrate', async () => {
  await mkdir(join(root, '.migrate'), { recursive: true })
  await mkdir(join(root, 'a', 'b'), { recursive: true })
  expect(await findStoreRoot(join(root, 'a', 'b'))).toBe(root)
})

test('findStoreRoot returns null when there is no store', async () => {
  await mkdir(join(root, 'a'), { recursive: true })
  expect(await findStoreRoot(join(root, 'a'))).toBeNull()
})

test('storePaths puts every artifact under .migrate', () => {
  const p = storePaths(root)
  expect(p.config).toBe(join(root, '.migrate', 'config.toml'))
  expect(p.elements).toBe(join(root, '.migrate', 'elements.jsonl'))
  expect(p.queueDir).toBe(join(root, '.migrate', 'queue'))
  expect(p.phases).toBe(join(root, '.migrate', 'phases.json'))
})

test('assertNotUnderSource rejects a path inside the source tree', () => {
  const source = join(root, 'legacy')
  expect(() => assertNotUnderSource(join(source, 'x.md'), source)).toThrow(/source/)
  expect(() => assertNotUnderSource(join(source, '..', 'out.md'), source)).not.toThrow()
})

test('assertNotUnderSource is not fooled by a sibling with a shared prefix', () => {
  const source = join(root, 'legacy')
  expect(() => assertNotUnderSource(join(root, 'legacy-notes', 'x.md'), source)).not.toThrow()
})
