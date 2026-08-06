import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type FileChunk, splitFileChunks } from './diff-chunks.ts'

export const DEFAULT_SHARD_BUDGET = 6000
export const DEFAULT_SHARD_MAX_FILES = 80

export type ShardEntry = { id: number; path: string; files: string[]; lines: number }
export type ShardManifest = {
  budget: number
  maxFiles: number
  totalFiles: number
  totalLines: number
  shards: ShardEntry[]
}

/**
 * The directory a file is grouped under, capped at two segments. Cohesion is
 * not cosmetic: the architecture and code-smells focuses look for duplication,
 * boundary violations, and shotgun surgery, and splitting a module across
 * shards hides exactly those.
 */
export function groupKey(path: string): string {
  const parts = path.split('/')
  if (parts.length <= 1) return '.'
  return parts.slice(0, Math.min(2, parts.length - 1)).join('/')
}

export function planShards(chunks: FileChunk[], budget: number, maxFiles: number): FileChunk[][] {
  const groups = new Map<string, FileChunk[]>()
  for (const c of chunks) {
    const key = groupKey(c.path)
    const existing = groups.get(key)
    if (existing) existing.push(c)
    else groups.set(key, [c])
  }

  const shards: FileChunk[][] = []
  let current: FileChunk[] = []
  let currentLines = 0
  const flush = () => {
    if (current.length > 0) {
      shards.push(current)
      current = []
      currentLines = 0
    }
  }

  for (const members of groups.values()) {
    const groupLines = members.reduce((n, c) => n + c.lines, 0)
    // Start a fresh shard rather than straddle a group across a boundary, when
    // the whole group could fit on its own.
    if (
      current.length > 0 &&
      (currentLines + groupLines > budget || current.length + members.length > maxFiles)
    ) {
      flush()
    }
    for (const c of members) {
      if (
        current.length > 0 &&
        (currentLines + c.lines > budget || current.length + 1 > maxFiles)
      ) {
        flush()
      }
      current.push(c)
      currentLines += c.lines
    }
  }
  flush()
  return shards
}

/** Read `$RUN_DIR/diff.patch`, tolerating only its absence. A missing
 *  diff.patch means "nothing to shard"; anything else (permission error,
 *  disk error, EISDIR, ...) is a genuine failure and must propagate rather
 *  than silently turn into an empty manifest. */
async function readDiffPatch(runDir: string): Promise<string> {
  try {
    return await Bun.file(join(runDir, 'diff.patch')).text()
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? err.code : undefined
    if (code === 'ENOENT') return ''
    throw err
  }
}

/**
 * Split `$RUN_DIR/diff.patch` into budgeted shards. `diff.patch` is never
 * modified: shards are views over it, which is what keeps the critic's diff
 * excerpts, dedupe's evidence check, and the report's rendering working
 * unchanged.
 */
export async function shardDiff(
  runDir: string,
  opts: { budget?: number; maxFiles?: number } = {},
): Promise<ShardManifest> {
  const budget = opts.budget ?? DEFAULT_SHARD_BUDGET
  const maxFiles = opts.maxFiles ?? DEFAULT_SHARD_MAX_FILES
  const diff = await readDiffPatch(runDir)
  const chunks = splitFileChunks(diff)
  const totalLines = chunks.reduce((n, c) => n + c.lines, 0)
  const shardsDir = join(runDir, 'shards')
  await mkdir(shardsDir, { recursive: true })

  const planned = planShards(chunks, budget, maxFiles)
  let shards: ShardEntry[]
  if (planned.length === 0) {
    shards = []
  } else if (planned.length === 1) {
    // Single-shard passthrough: stage 4 takes the same path it took on 0.9.0.
    const only = planned[0] ?? []
    shards = [
      {
        id: 1,
        path: 'diff.patch',
        files: only.map((c) => c.path),
        lines: only.reduce((n, c) => n + c.lines, 0),
      },
    ]
  } else {
    shards = []
    for (const [i, members] of planned.entries()) {
      const id = i + 1
      const rel = `shards/shard-${id}.patch`
      await writeFile(join(runDir, rel), members.map((c) => c.text).join(''))
      shards.push({
        id,
        path: rel,
        files: members.map((c) => c.path),
        lines: members.reduce((n, c) => n + c.lines, 0),
      })
    }
  }

  const manifest: ShardManifest = {
    budget,
    maxFiles,
    totalFiles: chunks.length,
    totalLines,
    shards,
  }
  await writeFile(join(shardsDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}
