import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ShardManifest } from './shard.ts'

/** The shards stage 4 skipped at the gate, from the run's last `shard-coverage` entry. */
export type ShardCoverage = { skipped: Array<{ id: number; files: string[] }> }

function isMissingFile(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === 'ENOENT'
}

/** Null when no shard was skipped, which is every run that did not answer the gate that way. */
export async function readShardCoverage(runDir: string): Promise<ShardCoverage | null> {
  let log: string
  try {
    log = await readFile(join(runDir, 'log.jsonl'), 'utf8')
  } catch (err) {
    if (isMissingFile(err)) return null
    throw err
  }
  let skippedIds: number[] | null = null
  for (const line of log.split('\n').filter(Boolean)) {
    let entry: Record<string, unknown>
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (entry.stage !== 'shard-coverage' || entry.status !== 'partial') continue
    if (!Array.isArray(entry.skipped) || !entry.skipped.every((id) => Number.isInteger(id))) {
      throw new Error(`${join(runDir, 'log.jsonl')}: shard-coverage skipped must be shard ids`)
    }
    skippedIds = entry.skipped as number[]
  }
  if (skippedIds === null || skippedIds.length === 0) return null
  const manifestPath = join(runDir, 'shards', 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as ShardManifest
  return {
    skipped: skippedIds.map((id) => {
      const shard = manifest.shards.find((s) => s.id === id)
      if (!shard) {
        throw new Error(`${manifestPath}: shard ${id} was skipped but is not in the manifest`)
      }
      return { id, files: shard.files }
    }),
  }
}

export function describeUnreviewed(coverage: ShardCoverage): string {
  const ids = coverage.skipped.map((s) => s.id)
  const files = coverage.skipped.reduce((n, s) => n + s.files.length, 0)
  return `Not reviewed: ${ids.length === 1 ? 'shard' : 'shards'} ${ids.join(', ')} (${files} ${files === 1 ? 'file' : 'files'})`
}
