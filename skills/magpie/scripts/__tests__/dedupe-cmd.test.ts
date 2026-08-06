import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runDedupe } from '../dedupe-cmd.ts'
import type { ReviewFinding } from '../types.ts'

let runDir: string

beforeEach(async () => {
  runDir = await mkdtemp(join(tmpdir(), 'magpie-dedupe-'))
  await mkdir(join(runDir, 'findings'), { recursive: true })
})

afterEach(async () => {
  await rm(runDir, { recursive: true, force: true })
})

function f(id: string, file: string, line: number, title: string, domain: string): ReviewFinding {
  return {
    id,
    file,
    line,
    severity: 'medium',
    risk: { impact: 'medium', likelihood: 'possible', confidence: 'medium', action: 'should-fix' },
    title,
    description: 'd',
    domain,
  }
}

test('runDedupe reads focus files, writes deduped output', async () => {
  await writeFile(
    join(runDir, 'findings', 'bugs.json'),
    JSON.stringify([f('1', 'a.ts', 10, 'null deref happens here', 'bugs')]),
  )
  await writeFile(
    join(runDir, 'findings', 'security.json'),
    JSON.stringify([f('2', 'a.ts', 10, 'null deref happens here', 'security')]),
  )
  const exit = await runDedupe(runDir)
  expect(exit).toBe(0)
  const out = JSON.parse(await readFile(join(runDir, 'findings.deduped.json'), 'utf8'))
  expect(out).toHaveLength(1)
  expect(out[0]?.description).toContain('Also flagged by')
})

test('runDedupe tolerates missing focus files', async () => {
  await writeFile(
    join(runDir, 'findings', 'bugs.json'),
    JSON.stringify([f('1', 'a.ts', 10, 'null deref', 'bugs')]),
  )
  const exit = await runDedupe(runDir)
  expect(exit).toBe(0)
  const out = JSON.parse(await readFile(join(runDir, 'findings.deduped.json'), 'utf8'))
  expect(out).toHaveLength(1)
})

test('runDedupe with malformed focus file logs and continues', async () => {
  await writeFile(join(runDir, 'findings', 'bugs.json'), 'not json')
  await writeFile(
    join(runDir, 'findings', 'security.json'),
    JSON.stringify([f('1', 'a.ts', 10, 'something', 'security')]),
  )
  const exit = await runDedupe(runDir)
  expect(exit).toBe(0)
  const out = JSON.parse(await readFile(join(runDir, 'findings.deduped.json'), 'utf8'))
  expect(out).toHaveLength(1)
  const log = await readFile(join(runDir, 'log.jsonl'), 'utf8')
  expect(log).toContain('"stage":"dedupe"')
  expect(log).toContain('parse-error')
})

test('runDedupe with no findings files writes empty array', async () => {
  const exit = await runDedupe(runDir)
  expect(exit).toBe(0)
  const out = JSON.parse(await readFile(join(runDir, 'findings.deduped.json'), 'utf8'))
  expect(out).toHaveLength(0)
})

test('runDedupe attaches score to each finding', async () => {
  await writeFile(
    join(runDir, 'findings', 'bugs.json'),
    JSON.stringify([f('1', 'a.ts', 10, 'mid title', 'bugs')]),
  )
  const exit = await runDedupe(runDir)
  expect(exit).toBe(0)
  const out = JSON.parse(await readFile(join(runDir, 'findings.deduped.json'), 'utf8'))
  expect(out[0]?.score).toBeGreaterThan(0)
  expect(out[0]?.score).toBeLessThanOrEqual(10)
})

test('runDedupe drops findings below threshold and writes sidecar', async () => {
  const low: ReviewFinding = {
    ...f('low-1', 'a.ts', 10, 'tiny cleanup', 'code-smells'),
    severity: 'low',
    risk: { impact: 'low', likelihood: 'edge-case', confidence: 'low', action: 'optional' },
  }
  const high: ReviewFinding = {
    ...f('high-1', 'b.ts', 10, 'serious bug', 'bugs'),
    severity: 'blocker',
    risk: { impact: 'critical', likelihood: 'likely', confidence: 'high', action: 'must-fix' },
  }
  await writeFile(join(runDir, 'findings', 'bugs.json'), JSON.stringify([low, high]))
  const exit = await runDedupe(runDir, { threshold: 5 })
  expect(exit).toBe(0)
  const kept = JSON.parse(await readFile(join(runDir, 'findings.deduped.json'), 'utf8'))
  expect(kept.map((x: ReviewFinding) => x.id)).toEqual(['high-1'])
  const dropped = JSON.parse(await readFile(join(runDir, 'threshold-dropped.json'), 'utf8'))
  expect(dropped[0]?.id).toBe('low-1')
})

test('runDedupe with threshold 0 keeps everything', async () => {
  const low: ReviewFinding = {
    ...f('low-1', 'a.ts', 10, 'tiny cleanup', 'code-smells'),
    severity: 'low',
    risk: { impact: 'low', likelihood: 'edge-case', confidence: 'low', action: 'optional' },
  }
  await writeFile(join(runDir, 'findings', 'bugs.json'), JSON.stringify([low]))
  const exit = await runDedupe(runDir, { threshold: 0 })
  expect(exit).toBe(0)
  const kept = JSON.parse(await readFile(join(runDir, 'findings.deduped.json'), 'utf8'))
  expect(kept).toHaveLength(1)
})

test('runDedupe collects sharded focus files', async () => {
  await writeFile(
    join(runDir, 'findings', 'security.shard-1.json'),
    JSON.stringify([f('security-1', 'a.ts', 10, 'hardcoded token in the client', 'security')]),
  )
  await writeFile(
    join(runDir, 'findings', 'security.shard-2.json'),
    JSON.stringify([f('security-1', 'z.ts', 99, 'missing auth check on the handler', 'security')]),
  )
  const exit = await runDedupe(runDir, { threshold: 0 })
  expect(exit).toBe(0)
  const out = JSON.parse(await readFile(join(runDir, 'findings.deduped.json'), 'utf8'))
  expect(out).toHaveLength(2)
  const ids = out.map((x: { id: string }) => x.id).sort()
  expect(ids).toEqual(['security-s1-1', 'security-s2-1'])
})

test('runDedupe leaves unsharded ids untouched', async () => {
  await writeFile(
    join(runDir, 'findings', 'bugs.json'),
    JSON.stringify([f('bugs-1', 'a.ts', 10, 'off by one in the loop bound', 'bugs')]),
  )
  const exit = await runDedupe(runDir, { threshold: 0 })
  expect(exit).toBe(0)
  const out = JSON.parse(await readFile(join(runDir, 'findings.deduped.json'), 'utf8'))
  expect(out[0]?.id).toBe('bugs-1')
})

const LLM_FOCUSES = ['security', 'bugs', 'performance', 'code-smells', 'architecture'] as const

/** A manifest with `count` shards, shaped like the one `shardDiff` writes. */
async function writeManifest(count: number): Promise<void> {
  await mkdir(join(runDir, 'shards'), { recursive: true })
  const shards = Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    path: count === 1 ? 'diff.patch' : `shards/shard-${i + 1}.patch`,
    files: [`src/f${i + 1}.ts`],
    lines: 10,
  }))
  await writeFile(
    join(runDir, 'shards', 'manifest.json'),
    JSON.stringify({
      budget: 6000,
      maxFiles: 80,
      totalFiles: count,
      totalLines: 10 * count,
      shards,
    }),
  )
}

/** Run dedupe with stdout captured, the way a human at the terminal sees it. */
async function dedupeCapturingStdout(): Promise<{ exit: number; stdout: string }> {
  const out: string[] = []
  const origWrite = process.stdout.write.bind(process.stdout)
  process.stdout.write = ((s: string) => {
    out.push(s)
    return true
  }) as typeof process.stdout.write
  try {
    const exit = await runDedupe(runDir, { threshold: 0 })
    return { exit, stdout: out.join('') }
  } finally {
    process.stdout.write = origWrite
  }
}

async function dedupeLogEntry(status: string): Promise<Record<string, unknown> | undefined> {
  const log = await readFile(join(runDir, 'log.jsonl'), 'utf8')
  return log
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>)
    .find((e) => e.stage === 'dedupe' && e.status === status)
}

test('runDedupe reports nothing missing when every (focus, shard) file is present', async () => {
  await writeManifest(3)
  for (const focus of LLM_FOCUSES) {
    for (const shard of [1, 2, 3]) {
      await writeFile(
        join(runDir, 'findings', `${focus}.shard-${shard}.json`),
        JSON.stringify([f(`${focus}-1`, `s${shard}.ts`, 1, `${focus} on shard ${shard}`, focus)]),
      )
    }
  }
  // Setup writes tests.json once for the whole run, never per shard.
  await writeFile(join(runDir, 'findings', 'tests.json'), JSON.stringify([]))
  const { exit, stdout } = await dedupeCapturingStdout()
  expect(exit).toBe(0)
  expect(stdout).not.toContain('missing')
  expect(stdout).toContain('15')
  const done = await dedupeLogEntry('done')
  expect(done?.coverage).toEqual({ expected: 15, missing: [] })
})

test('runDedupe names the (focus, shard) pairs that have no findings file', async () => {
  await writeManifest(2)
  for (const focus of LLM_FOCUSES) {
    await writeFile(
      join(runDir, 'findings', `${focus}.shard-1.json`),
      JSON.stringify([f(`${focus}-1`, 'a.ts', 1, `${focus} on shard 1`, focus)]),
    )
  }
  // Shard 2 lost security and bugs: two of ten agents never wrote a file.
  for (const focus of ['performance', 'code-smells', 'architecture']) {
    await writeFile(
      join(runDir, 'findings', `${focus}.shard-2.json`),
      JSON.stringify([f(`${focus}-1`, 'b.ts', 2, `${focus} on shard 2`, focus)]),
    )
  }
  const { exit, stdout } = await dedupeCapturingStdout()
  expect(exit).toBe(0)
  expect(stdout).toContain('missing')
  expect(stdout).toContain('security.shard-2.json')
  expect(stdout).toContain('bugs.shard-2.json')
  const done = await dedupeLogEntry('done')
  expect(done?.coverage).toEqual({
    expected: 10,
    missing: ['security.shard-2.json', 'bugs.shard-2.json'],
  })
})

test('a single-shard manifest expects the unsharded findings filenames', async () => {
  await writeManifest(1)
  for (const focus of ['security', 'bugs', 'performance', 'code-smells']) {
    await writeFile(
      join(runDir, 'findings', `${focus}.json`),
      JSON.stringify([f(`${focus}-1`, 'a.ts', 1, `${focus} finding here`, focus)]),
    )
  }
  const { stdout } = await dedupeCapturingStdout()
  // Stage 4 takes the unsharded path on a single-shard run, so the expected name
  // has no shard suffix.
  expect(stdout).toContain('architecture.json')
  const done = await dedupeLogEntry('done')
  expect(done?.coverage).toEqual({ expected: 5, missing: ['architecture.json'] })
})

test('runDedupe without a manifest reports no coverage at all', async () => {
  await writeFile(
    join(runDir, 'findings', 'bugs.json'),
    JSON.stringify([f('bugs-1', 'a.ts', 10, 'off by one in the loop bound', 'bugs')]),
  )
  const { exit, stdout } = await dedupeCapturingStdout()
  expect(exit).toBe(0)
  // A run predating the sharder has nothing to reconcile against; behaviour is
  // exactly as before.
  expect(stdout).toBe('')
  const done = await dedupeLogEntry('done')
  expect(done).toBeDefined()
  expect(done?.coverage).toBeUndefined()
})

test('a zero-shard manifest expects nothing (the diff filtered down to nothing)', async () => {
  await writeManifest(0)
  const { exit, stdout } = await dedupeCapturingStdout()
  expect(exit).toBe(0)
  expect(stdout).toBe('')
  const done = await dedupeLogEntry('done')
  expect(done?.coverage).toBeUndefined()
})

test('a malformed shards/manifest.json is treated as no manifest', async () => {
  await mkdir(join(runDir, 'shards'), { recursive: true })
  await writeFile(join(runDir, 'shards', 'manifest.json'), '{ not json')
  const { exit, stdout } = await dedupeCapturingStdout()
  expect(exit).toBe(0)
  expect(stdout).toBe('')
  const done = await dedupeLogEntry('done')
  expect(done?.coverage).toBeUndefined()
})

test('runDedupe still skips files it cannot map to a focus', async () => {
  await writeFile(join(runDir, 'findings', 'nonsense.json'), JSON.stringify([]))
  await writeFile(join(runDir, 'findings', 'security.shard-x.json'), JSON.stringify([]))
  const exit = await runDedupe(runDir)
  expect(exit).toBe(0)
  const log = await readFile(join(runDir, 'log.jsonl'), 'utf8')
  const skips = log
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((e) => e.status === 'skip' && e.reason === 'unknown-focus')
  expect(skips.map((s) => s.file).sort()).toEqual(['nonsense.json', 'security.shard-x.json'])
})
