import { afterEach, beforeEach, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_SHARD_BUDGET, groupKey, planShards, shardDiff } from '../shard.ts'

let runDir: string

beforeEach(async () => {
  runDir = await mkdtemp(join(tmpdir(), 'magpie-shard-'))
})

afterEach(async () => {
  await rm(runDir, { recursive: true, force: true })
})

/** A file chunk with `bodyLines` added lines, shaped like a real patch. */
function chunk(path: string, bodyLines: number): string {
  const body = Array.from({ length: bodyLines }, (_, i) => `+line ${i}`).join('\n')
  return [
    `diff --git a/${path} b/${path}`,
    'index 0000000..1111111 100644',
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -0,0 +1,${bodyLines} @@`,
    body,
    '',
  ].join('\n')
}

test('groupKey caps the grouping directory at two segments', () => {
  expect(groupKey('src/cli/commands/install.ts')).toBe('src/cli')
  expect(groupKey('src/a.ts')).toBe('src')
  expect(groupKey('README.md')).toBe('.')
})

test('planShards keeps a directory group together when it fits', () => {
  const chunks = [
    { path: 'src/cli/a.ts', text: '', lines: 100 },
    { path: 'src/web/b.ts', text: '', lines: 100 },
    { path: 'src/cli/c.ts', text: '', lines: 100 },
  ]
  const shards = planShards(chunks, 1000, 80)
  expect(shards).toHaveLength(1)
  // Grouping reorders: both src/cli files are adjacent.
  expect(shards[0]?.map((c) => c.path)).toEqual(['src/cli/a.ts', 'src/cli/c.ts', 'src/web/b.ts'])
})

test('planShards splits when the line budget is exceeded', () => {
  const chunks = [
    { path: 'src/a/1.ts', text: '', lines: 600 },
    { path: 'src/b/2.ts', text: '', lines: 600 },
    { path: 'src/c/3.ts', text: '', lines: 600 },
  ]
  const shards = planShards(chunks, 1000, 80)
  expect(shards).toHaveLength(3)
})

test('planShards splits when max-files is reached before the budget', () => {
  const chunks = Array.from({ length: 5 }, (_, i) => ({
    path: `src/g${i}/f.ts`,
    text: '',
    lines: 1,
  }))
  const shards = planShards(chunks, 10_000, 2)
  expect(shards).toHaveLength(3)
  expect(shards[0]).toHaveLength(2)
  expect(shards[2]).toHaveLength(1)
})

test('planShards gives an over-budget file a shard to itself', () => {
  const chunks = [
    { path: 'src/a/small.ts', text: '', lines: 10 },
    { path: 'src/b/huge.ts', text: '', lines: 9000 },
    { path: 'src/c/other.ts', text: '', lines: 10 },
  ]
  const shards = planShards(chunks, 1000, 80)
  expect(shards).toHaveLength(3)
  expect(shards[1]?.map((c) => c.path)).toEqual(['src/b/huge.ts'])
})

test('shardDiff writes a single-shard manifest pointing at diff.patch', async () => {
  await writeFile(join(runDir, 'diff.patch'), chunk('src/a.ts', 3))
  const manifest = await shardDiff(runDir)
  expect(manifest.shards).toHaveLength(1)
  expect(manifest.shards[0]?.path).toBe('diff.patch')
  expect(manifest.totalFiles).toBe(1)
  expect(manifest.budget).toBe(DEFAULT_SHARD_BUDGET)
  expect(existsSync(join(runDir, 'shards', 'shard-1.patch'))).toBe(false)
  const onDisk = JSON.parse(await readFile(join(runDir, 'shards', 'manifest.json'), 'utf8'))
  expect(onDisk.shards[0].files).toEqual(['src/a.ts'])
})

test('shardDiff writes one patch per shard when the budget forces a split', async () => {
  const diff = chunk('src/a/one.ts', 200) + chunk('src/b/two.ts', 200)
  await writeFile(join(runDir, 'diff.patch'), diff)
  const manifest = await shardDiff(runDir, { budget: 150 })
  expect(manifest.shards).toHaveLength(2)
  expect(manifest.shards[0]?.path).toBe('shards/shard-1.patch')
  const first = await readFile(join(runDir, 'shards', 'shard-1.patch'), 'utf8')
  expect(first).toContain('diff --git a/src/a/one.ts')
  expect(first).not.toContain('src/b/two.ts')
  // diff.patch is a view source, never replaced.
  const whole = await readFile(join(runDir, 'diff.patch'), 'utf8')
  expect(whole).toContain('src/a/one.ts')
  expect(whole).toContain('src/b/two.ts')
})

test('shardDiff handles an empty diff without writing shard files', async () => {
  await writeFile(join(runDir, 'diff.patch'), '')
  const manifest = await shardDiff(runDir)
  expect(manifest.shards).toEqual([])
  expect(manifest.totalFiles).toBe(0)
})

test('shardDiff propagates a non-ENOENT read failure instead of treating it as an empty diff', async () => {
  // Make diff.patch a directory: reading it as text is a real, portable I/O
  // failure (EISDIR) that is not "file absent" and must not be swallowed.
  await mkdir(join(runDir, 'diff.patch'))
  await expect(shardDiff(runDir)).rejects.toThrow()
})

test('shardDiff treats a diff.patch that does not exist yet as an empty diff', async () => {
  // No writeFile at all here: diff.patch is genuinely absent, the one case
  // the ENOENT branch exists to tolerate. Task 4 wires shardDiff into
  // runSetup and Task 6 reads the manifest unconditionally, so "no diff yet"
  // must still leave a readable manifest rather than a missing file.
  expect(existsSync(join(runDir, 'diff.patch'))).toBe(false)
  const manifest = await shardDiff(runDir)
  expect(manifest.shards).toEqual([])
  expect(manifest.totalFiles).toBe(0)
  expect(manifest.totalLines).toBe(0)
  expect(existsSync(join(runDir, 'shards', 'manifest.json'))).toBe(true)
})
