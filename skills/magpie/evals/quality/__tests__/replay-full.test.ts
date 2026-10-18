import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { replayDiagnostics, replaySummary, shardCoverageCount } from '../replay-full.ts'

const base = {
  runId: 'pr-50-1789099641',
  kept: 12,
  unlabelled: 4,
  precision: 0.5,
  recall: 0.75,
  costUsd: 3.456,
  outPath: '/corpus/results/x-full-pr-50-1789099641.json',
  coverage: { reviewed: 3, total: 7 },
}

test('a replay without a recall set prints no missed-recall figure', () => {
  expect(replaySummary({ ...base, missedRecall: null })).toBe(
    'pr-50-1789099641: kept 12 (4 unlabelled), precision 0.50, recall 0.75, cost $3.46, shards 3/7\n' +
      'wrote /corpus/results/x-full-pr-50-1789099641.json\n',
  )
})

test('a replay judged against a recall set prints caught over misses', () => {
  expect(replaySummary({ ...base, missedRecall: { caught: 3, misses: 14 } })).toBe(
    'pr-50-1789099641: kept 12 (4 unlabelled), precision 0.50, recall 0.75, cost $3.46, ' +
      'missed-recall 3/14, shards 3/7\nwrote /corpus/results/x-full-pr-50-1789099641.json\n',
  )
})

test('a replay whose cost Claude did not report says so', () => {
  expect(
    replaySummary({ ...base, precision: null, recall: null, costUsd: null, missedRecall: null }),
  ).toBe(
    'pr-50-1789099641: kept 12 (4 unlabelled), precision -, recall -, cost unreported, shards 3/7\n' +
      'wrote /corpus/results/x-full-pr-50-1789099641.json\n',
  )
})

function manifestOf(shardCount: number) {
  return {
    budget: 6000,
    maxFiles: 80,
    totalFiles: shardCount,
    totalLines: 10 * shardCount,
    shards: Array.from({ length: shardCount }, (_, i) => ({
      id: i + 1,
      path: shardCount === 1 ? 'diff.patch' : `shards/shard-${i + 1}.patch`,
      files: [`src/f${i + 1}.ts`],
      lines: 10,
    })),
  }
}

test('a sharded replay counts only the shards some specialist wrote findings for', () => {
  const files = [
    'bugs.shard-4.json',
    'bugs.shard-5.json',
    'security.shard-5.json',
    'architecture.shard-6.json',
    'code-smells.shard-7.json',
    'tests.json',
  ]
  expect(shardCoverageCount(manifestOf(7), files)).toEqual({ reviewed: 4, total: 7 })
})

test('a single-shard replay counts as reviewed when a specialist wrote its unsharded file', () => {
  expect(shardCoverageCount(manifestOf(1), ['bugs.json', 'tests.json'])).toEqual({
    reviewed: 1,
    total: 1,
  })
})

test('a single-shard replay with only the tests finding counts as unreviewed', () => {
  expect(shardCoverageCount(manifestOf(1), ['tests.json'])).toEqual({ reviewed: 0, total: 1 })
})

test('a replay with no shard manifest reports no shards', () => {
  expect(shardCoverageCount(null, ['bugs.json'])).toEqual({ reviewed: 0, total: 0 })
})

test('a manifest without a shards array is rejected', () => {
  expect(() => shardCoverageCount({ budget: 6000 }, [])).toThrow('shards')
})

async function scratchRunDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'magpie-replay-diag-'))
  await mkdir(join(dir, 'findings'))
  return dir
}

test('diagnostics carry the log, manifest, findings files, deduped count and critic drops', async () => {
  const dir = await scratchRunDir()
  await writeFile(
    join(dir, 'log.jsonl'),
    '{"stage":"setup","status":"done"}\n\n{"stage":"critic","status":"done","kept":8}\n',
  )
  await mkdir(join(dir, 'shards'))
  await writeFile(join(dir, 'shards', 'manifest.json'), JSON.stringify(manifestOf(2)))
  await writeFile(join(dir, 'findings', 'security.shard-2.json'), '[]')
  await writeFile(join(dir, 'findings', 'bugs.shard-1.json'), '[]')
  await writeFile(join(dir, 'findings.deduped.json'), '[{"id":"a"},{"id":"b"},{"id":"c"}]')
  await writeFile(join(dir, 'critic-dropped.json'), '[{"id":"b","reason":"speculative"}]')

  expect(await replayDiagnostics(dir)).toEqual({
    log: [
      { stage: 'setup', status: 'done' },
      { stage: 'critic', status: 'done', kept: 8 },
    ],
    shardManifest: manifestOf(2),
    findingsFiles: ['bugs.shard-1.json', 'security.shard-2.json'],
    dedupedCount: 3,
    criticDropped: [{ id: 'b', reason: 'speculative' }],
    evidenceDropped: null,
    thresholdDropped: null,
  })
})

test('diagnostics report absent manifest, deduped and drop files as null', async () => {
  const dir = await scratchRunDir()
  await writeFile(join(dir, 'log.jsonl'), '{"stage":"setup","status":"done"}\n')

  expect(await replayDiagnostics(dir)).toEqual({
    log: [{ stage: 'setup', status: 'done' }],
    shardManifest: null,
    findingsFiles: [],
    dedupedCount: null,
    criticDropped: null,
    evidenceDropped: null,
    thresholdDropped: null,
  })
})

test('a log line that is not a JSON object is kept raw in its place with its line number', async () => {
  const dir = await scratchRunDir()
  await writeFile(
    join(dir, 'log.jsonl'),
    '{"stage":"setup","status":"done"}\n{"stage":"shard"\n[1,2]\n{"stage":"critic"}\n',
  )
  expect((await replayDiagnostics(dir)).log).toEqual([
    { stage: 'setup', status: 'done' },
    { unparsed: '{"stage":"shard"', line: 2 },
    { unparsed: '[1,2]', line: 3 },
    { stage: 'critic' },
  ])
})

test('diagnostics carry the evidence and threshold drops when the run wrote them', async () => {
  const dir = await scratchRunDir()
  await writeFile(join(dir, 'log.jsonl'), '{"stage":"setup","status":"done"}\n')
  await writeFile(join(dir, 'evidence-dropped.json'), '[{"id":"e1","reason":"quote not in diff"}]')
  await writeFile(join(dir, 'threshold-dropped.json'), '[{"id":"t1","confidence":0.2}]')
  const diagnostics = await replayDiagnostics(dir)
  expect(diagnostics.evidenceDropped).toEqual([{ id: 'e1', reason: 'quote not in diff' }])
  expect(diagnostics.thresholdDropped).toEqual([{ id: 't1', confidence: 0.2 }])
})

test('a deduped findings file that is not an array is rejected', async () => {
  const dir = await scratchRunDir()
  await writeFile(join(dir, 'log.jsonl'), '{"stage":"setup","status":"done"}\n')
  await writeFile(join(dir, 'findings.deduped.json'), '{"id":"a"}')
  await expect(replayDiagnostics(dir)).rejects.toThrow('findings.deduped.json')
})
