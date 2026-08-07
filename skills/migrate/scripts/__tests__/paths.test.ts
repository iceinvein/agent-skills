import { afterEach, beforeEach, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
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

// Platform support is detected once, synchronously, at module load, so
// test.skipIf's condition is known before any test runs rather than
// discovered mid-test.

function detectSymlinkSupport(): boolean {
  const dir = mkdtempSync(join(tmpdir(), 'migrate-symlink-check-'))
  try {
    symlinkSync(join(dir, 'target'), join(dir, 'link'))
    return true
  } catch {
    return false
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function detectCaseInsensitiveFs(): boolean {
  const dir = mkdtempSync(join(tmpdir(), 'migrate-case-check-'))
  try {
    mkdirSync(join(dir, 'src'))
    return existsSync(join(dir, 'SRC'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const SYMLINKS_SUPPORTED = detectSymlinkSupport()
const CASE_INSENSITIVE_FS = detectCaseInsensitiveFs()

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

test('assertNotUnderSource rejects a path inside the source tree', async () => {
  const source = join(root, 'legacy')
  await expect(assertNotUnderSource(join(source, 'x.md'), source)).rejects.toThrow(/source/)
  await expect(assertNotUnderSource(join(source, '..', 'out.md'), source)).resolves.toBeUndefined()
})

test('assertNotUnderSource is not fooled by a sibling with a shared prefix', async () => {
  const source = join(root, 'legacy')
  await expect(
    assertNotUnderSource(join(root, 'legacy-notes', 'x.md'), source),
  ).resolves.toBeUndefined()
})

test('assertNotUnderSource allows writes to the source parent directory', async () => {
  const source = join(root, 'legacy')
  await expect(assertNotUnderSource(root, source)).resolves.toBeUndefined()
})

// Important finding 1, bypass 1: a lexical-only comparison never resolves
// symlinks, so a target reached only through a symlinked directory can
// really land inside the source tree while comparing as "outside" on raw
// path text. Here `.migrate` itself -- the exact shape named in the report
// -- is a symlink into the source tree; storePaths' own path construction
// (`join(root, '.migrate', 'elements.jsonl')`) is used verbatim so this
// reproduces the real write path, not a synthetic one.
test.skipIf(!SYMLINKS_SUPPORTED)(
  'assertNotUnderSource follows a .migrate directory symlinked into the source tree',
  async () => {
    const source = join(root, 'legacy')
    const insideSource = join(source, 'landing-zone')
    await mkdir(insideSource, { recursive: true })
    await symlink(insideSource, join(root, '.migrate'))
    const target = storePaths(root).elements
    await expect(assertNotUnderSource(target, source)).rejects.toThrow(/source/)
  },
)

// Important finding 1, bypass 2: on a case-insensitive volume, a config
// declaring the source at one case spelling and a store computed from a
// project root spelled with a different case name the same physical
// directory, but plain string comparison sees two unrelated paths. Skipped
// cleanly (not failed) on a case-sensitive filesystem, where this scenario
// cannot arise at all.
test.skipIf(!CASE_INSENSITIVE_FS)(
  'assertNotUnderSource is not fooled by a case-variant spelling of the source root',
  async () => {
    const declaredSource = join(root, 'ci', 'src')
    await mkdir(declaredSource, { recursive: true })
    const target = join(root, 'ci', 'SRC', '.migrate', 'elements.jsonl')
    await expect(assertNotUnderSource(target, declaredSource)).rejects.toThrow(/source/)
  },
)

// A write target need not exist yet -- that is the normal case for a store
// file about to be created for the first time -- so the fix must resolve
// containment from the nearest existing ancestor rather than requiring the
// target itself to exist.
test('assertNotUnderSource resolves containment even when the target does not exist yet', async () => {
  const source = join(root, 'legacy')
  await mkdir(source, { recursive: true })
  const target = join(root, 'project', '.migrate', 'elements.jsonl')
  await mkdir(join(root, 'project'), { recursive: true })
  await expect(assertNotUnderSource(target, source)).resolves.toBeUndefined()
})
