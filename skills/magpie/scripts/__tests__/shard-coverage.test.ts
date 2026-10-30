import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describeUnreviewed, readShardCoverage } from '../shard-coverage.ts'

let runDir: string

beforeEach(async () => {
  runDir = await mkdtemp(join(tmpdir(), 'magpie-coverage-'))
  await mkdir(join(runDir, 'shards'))
  await writeFile(
    join(runDir, 'shards', 'manifest.json'),
    JSON.stringify({
      budget: 6000,
      maxFiles: 80,
      totalFiles: 4,
      totalLines: 40,
      shards: [
        { id: 1, path: 'shards/shard-1.patch', files: ['src/a.ts'], lines: 10 },
        { id: 2, path: 'shards/shard-2.patch', files: ['src/b.ts', 'src/c.ts'], lines: 20 },
        { id: 3, path: 'shards/shard-3.patch', files: ['docs/d.md'], lines: 10 },
      ],
    }),
  )
})

afterEach(async () => {
  await rm(runDir, { recursive: true, force: true })
})

async function writeLog(entries: Array<Record<string, unknown>>): Promise<void> {
  await writeFile(join(runDir, 'log.jsonl'), entries.map((e) => `${JSON.stringify(e)}\n`).join(''))
}

test('the skipped shards and their files come from the shard-coverage entry and the manifest', async () => {
  await writeLog([
    { stage: 'setup', status: 'done' },
    { stage: 'shard-coverage', status: 'partial', reviewed: [1], skipped: [2, 3] },
  ])
  expect(await readShardCoverage(runDir)).toEqual({
    skipped: [
      { id: 2, files: ['src/b.ts', 'src/c.ts'] },
      { id: 3, files: ['docs/d.md'] },
    ],
  })
})

test('the last shard-coverage entry wins', async () => {
  await writeLog([
    { stage: 'shard-coverage', status: 'partial', reviewed: [1], skipped: [2, 3] },
    { stage: 'shard-coverage', status: 'partial', reviewed: [1, 2], skipped: [3] },
  ])
  expect(await readShardCoverage(runDir)).toEqual({ skipped: [{ id: 3, files: ['docs/d.md'] }] })
})

test('a run that reviewed every shard has no coverage gap', async () => {
  await writeLog([{ stage: 'specialists', status: 'done' }])
  expect(await readShardCoverage(runDir)).toBeNull()
})

test('a skipped shard the manifest does not have is rejected, naming it', async () => {
  await writeLog([{ stage: 'shard-coverage', status: 'partial', reviewed: [1], skipped: [9] }])
  await expect(readShardCoverage(runDir)).rejects.toThrow('shard 9')
})

test('the gap reads as the shard ids and the file count', () => {
  expect(
    describeUnreviewed({
      skipped: [
        { id: 2, files: ['src/b.ts', 'src/c.ts'] },
        { id: 3, files: ['docs/d.md'] },
      ],
    }),
  ).toBe('Not reviewed: shards 2, 3 (3 files)')
  expect(describeUnreviewed({ skipped: [{ id: 3, files: ['docs/d.md'] }] })).toBe(
    'Not reviewed: shard 3 (1 file)',
  )
})
