import { appendFile, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  buildImpactMap,
  extractDiffNames,
  type GrepHit,
  type GrepPlan,
  type ImpactMap,
  parseGrepOutput,
  planSearches,
} from './impact.ts'
import {
  IMPACT_BRIEF_CAP_BYTES,
  IMPACT_BRIEF_MAX_CHILDREN,
  IMPACT_FULL_CAP_BYTES,
  renderImpactMarkdown,
} from './impact-render.ts'
import { loadPathFilterConfig, matchesAny, type PathFilterConfig } from './path-filter.ts'
import type { ShardEntry } from './shard.ts'
import { reviewRoot } from './target.ts'

const IMPACT_FILE = /^impact(?:\.brief)?\.md$|^impact\.json$|^impact\.shard-.*\.md$/

async function logLine(runDir: string, entry: Record<string, unknown>): Promise<void> {
  await appendFile(join(runDir, 'log.jsonl'), `${JSON.stringify({ ...entry, ts: Date.now() })}\n`)
}

function isMissingFile(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === 'ENOENT'
}

async function readDiff(runDir: string): Promise<string> {
  const path = join(runDir, 'diff.patch')
  try {
    return await readFile(path, 'utf8')
  } catch (err) {
    if (isMissingFile(err)) throw new Error(`${path} not found`)
    throw err
  }
}

// git grep exits 1 when nothing matches, which is an empty result, not a failure.
async function runGrep(root: string, plan: GrepPlan): Promise<GrepHit[]> {
  const proc = Bun.spawn(['git', ...plan.args], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
  const [out, err, exit] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (exit === 1) return []
  if (exit !== 0) throw new Error(`git grep exited ${exit}: ${err.trim()}`)
  return parseGrepOutput(out)
}

/** A run with no manifest was never sharded, which is the same as one shard. */
async function readShards(runDir: string): Promise<ShardEntry[]> {
  const path = join(runDir, 'shards', 'manifest.json')
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (err) {
    if (isMissingFile(err)) return []
    throw err
  }
  const shards = (JSON.parse(text) as { shards?: unknown }).shards
  if (!Array.isArray(shards)) throw new Error(`${path}: shards must be an array`)
  for (const s of shards as Array<Partial<ShardEntry>>) {
    if (typeof s?.id !== 'number' || !Array.isArray(s.files)) {
      throw new Error(`${path}: each shard needs a numeric id and a files array`)
    }
  }
  return shards as ShardEntry[]
}

// The same include/exclude decision filterDiff applies to the diff.
function isFilteredOut(file: string, config: PathFilterConfig): boolean {
  if (config.include.length > 0) return matchesAny(file, config.include) === null
  return matchesAny(file, config.exclude) !== null
}

async function removeImpactFiles(runDir: string): Promise<void> {
  for (const name of await readdir(runDir)) {
    if (IMPACT_FILE.test(name)) await rm(join(runDir, name), { force: true })
  }
}

async function writeIfNonEmpty(path: string, text: string): Promise<void> {
  if (text.length > 0) await writeFile(path, `${text}\n`)
}

async function writeRenders(runDir: string, map: ImpactMap, prefix: string, shard: number | null) {
  await writeIfNonEmpty(
    join(runDir, `${prefix}.md`),
    renderImpactMarkdown(map, { shard, capBytes: IMPACT_FULL_CAP_BYTES }),
  )
  await writeIfNonEmpty(
    join(runDir, `${prefix}.brief.md`),
    renderImpactMarkdown(map, {
      shard,
      capBytes: IMPACT_BRIEF_CAP_BYTES,
      maxChildren: IMPACT_BRIEF_MAX_CHILDREN,
    }),
  )
}

async function buildMap(runDir: string, root: string, shards: ShardEntry[]): Promise<ImpactMap> {
  const names = extractDiffNames(await readDiff(runDir))
  const config = await loadPathFilterConfig(root)
  const hits: Record<GrepPlan['kind'], GrepHit[]> = {
    references: [],
    definitions: [],
    writers: [],
    routes: [],
    docs: [],
  }
  for (const plan of planSearches(names)) hits[plan.kind].push(...(await runGrep(root, plan)))
  const sharded = shards.length > 1
  return buildImpactMap({
    names,
    hits,
    shardOf: (file) => (sharded ? (shards.find((s) => s.files.includes(file))?.id ?? null) : null),
    excluded: (file) => isFilteredOut(file, config),
  })
}

export async function runImpact(runDir: string): Promise<number> {
  const isDir = await stat(runDir)
    .then((s) => s.isDirectory())
    .catch(() => false)
  if (!isDir) {
    process.stderr.write(`impact: no such run directory: ${runDir}\n`)
    return 2
  }
  let root: string
  try {
    root = await reviewRoot(runDir)
  } catch (err) {
    process.stderr.write(`impact: ${err instanceof Error ? err.message : String(err)}\n`)
    return 2
  }

  try {
    // Cleared before the search so a skipped re-run leaves no map from an older diff.
    await removeImpactFiles(runDir)
    const shards = await readShards(runDir)
    const map = await buildMap(runDir, root, shards)
    await writeFile(join(runDir, 'impact.json'), `${JSON.stringify(map, null, 2)}\n`)
    await writeRenders(runDir, map, 'impact', null)
    if (shards.length > 1) {
      for (const s of shards) await writeRenders(runDir, map, `impact.shard-${s.id}`, s.id)
    }
    await logLine(runDir, {
      stage: 'impact',
      status: 'done',
      symbols: map.symbols.length,
      uses: map.uses.length,
      stores: map.stores.length,
      routes: map.routes.length,
      docs: map.docs.length,
    })
    return 0
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await logLine(runDir, { stage: 'impact', status: 'skipped', error: message })
    process.stderr.write(`impact: skipped: ${message}\n`)
    return 0
  }
}

export async function readImpactMap(runDir: string): Promise<ImpactMap | null> {
  const path = join(runDir, 'impact.json')
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (err) {
    if (isMissingFile(err)) return null
    throw err
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    throw new Error(`${path}: not valid JSON (${err instanceof Error ? err.message : String(err)})`)
  }
  const map = raw as Partial<Record<keyof ImpactMap, unknown>> | null
  if (map?.version !== 1) throw new Error(`${path}: version must be 1`)
  for (const key of ['symbols', 'uses', 'stores', 'routes', 'docs'] as const) {
    if (!Array.isArray(map[key])) throw new Error(`${path}: ${key} must be an array`)
  }
  return raw as ImpactMap
}
