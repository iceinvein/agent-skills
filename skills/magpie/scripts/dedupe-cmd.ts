import { appendFile, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { annotateChangedLines } from './changed-lines.ts'
import { deduplicateFindings } from './dedupe.ts'
import { verifyEvidence } from './evidence-filter.ts'
import { namespaceId, parseFindingsFilename } from './findings-files.ts'
import { DEFAULT_THRESHOLD, scoreRisk } from './score.ts'
import { FOCUS_IDS, parseFinding, type ReviewFinding } from './types.ts'

async function logLine(runDir: string, entry: Record<string, unknown>): Promise<void> {
  const line = `${JSON.stringify({ ...entry, ts: Date.now() })}\n`
  await appendFile(join(runDir, 'log.jsonl'), line)
}

export type RunDedupeOptions = {
  /** 0-10 importance score below which findings are dropped pre-critic. */
  threshold?: number
}

/**
 * The five focuses a specialist subagent writes. `tests` is a `FOCUS_IDS` entry
 * too, but setup writes `findings/tests.json` once for the whole run with no
 * subagent, so it is never expected per shard.
 */
const SPECIALIST_FOCUS_IDS = FOCUS_IDS.filter((id) => id !== 'tests')

type Coverage = { expected: number; missing: string[] }

/**
 * Reconcile the findings files on disk against the `(focus, shard)` pairs the
 * shard manifest implies. Stage 4 fails the run only when *every* specialist
 * fails, so a sharded run that lost one agent out of thirty still logs
 * `specialists: done` and renders a report indistinguishable from a complete
 * one. Returns null when there is nothing to reconcile against (no manifest, an
 * unreadable one, or a manifest with no shards, which is what an empty or
 * fully-filtered diff produces), leaving pre-sharder runs behaving exactly as
 * they did before.
 */
async function reconcileCoverage(runDir: string, present: Set<string>): Promise<Coverage | null> {
  let shards: Array<Record<string, unknown>>
  try {
    const manifest = (await Bun.file(join(runDir, 'shards', 'manifest.json')).json()) as {
      shards?: unknown
    }
    if (!Array.isArray(manifest.shards) || manifest.shards.length === 0) return null
    shards = manifest.shards as Array<Record<string, unknown>>
  } catch {
    return null
  }
  // A single-shard manifest means stage 4 took the unsharded path, so its
  // specialists write `<focus>.json` with no shard suffix.
  const sharded = shards.length > 1
  const expected: string[] = []
  for (const [i, shard] of shards.entries()) {
    const id = typeof shard?.id === 'number' ? shard.id : i + 1
    for (const focus of SPECIALIST_FOCUS_IDS) {
      expected.push(sharded ? `${focus}.shard-${id}.json` : `${focus}.json`)
    }
  }
  return { expected: expected.length, missing: expected.filter((name) => !present.has(name)) }
}

export async function runDedupe(runDir: string, options: RunDedupeOptions = {}): Promise<number> {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD
  const findingsDir = join(runDir, 'findings')
  const collected: ReviewFinding[] = []
  let files: string[]
  try {
    files = await readdir(findingsDir)
  } catch {
    files = []
  }

  for (const name of files) {
    if (!name.endsWith('.json')) continue
    const parsed = parseFindingsFilename(name)
    if (!parsed || !FOCUS_IDS.includes(parsed.focus as (typeof FOCUS_IDS)[number])) {
      await logLine(runDir, {
        stage: 'dedupe',
        status: 'skip',
        reason: 'unknown-focus',
        file: name,
      })
      continue
    }
    const { focus, shard } = parsed
    const path = join(findingsDir, name)
    let raw: unknown
    try {
      raw = JSON.parse(await readFile(path, 'utf8'))
    } catch (err) {
      await logLine(runDir, {
        stage: 'dedupe',
        status: 'parse-error',
        file: name,
        error: String(err),
      })
      continue
    }
    if (!Array.isArray(raw)) {
      await logLine(runDir, {
        stage: 'dedupe',
        status: 'parse-error',
        file: name,
        error: 'expected array',
      })
      continue
    }
    for (const item of raw) {
      try {
        const finding = parseFinding(item)
        collected.push({ ...finding, id: namespaceId(finding.id, focus, shard) })
      } catch (err) {
        await logLine(runDir, {
          stage: 'dedupe',
          status: 'parse-error',
          file: name,
          error: String(err),
        })
      }
    }
  }

  const deduped = deduplicateFindings(collected)
  const scored = deduped.map((f) => ({ ...f, score: scoreRisk(f.risk) }))
  const evidence = await verifyEvidence(scored, join(runDir, 'worktree'))
  let diff = ''
  try {
    diff = await readFile(join(runDir, 'diff.patch'), 'utf8')
  } catch {
    diff = ''
  }
  const annotated = annotateChangedLines(evidence.kept, diff)
  const aboveThreshold = annotated.filter((f) => (f.score ?? 0) >= threshold)
  const belowThreshold = annotated.filter((f) => (f.score ?? 0) < threshold)
  await writeFile(
    join(runDir, 'findings.deduped.json'),
    `${JSON.stringify(aboveThreshold, null, 2)}\n`,
  )
  if (evidence.dropped.length > 0) {
    await writeFile(
      join(runDir, 'evidence-dropped.json'),
      `${JSON.stringify(evidence.dropped, null, 2)}\n`,
    )
  }
  if (belowThreshold.length > 0) {
    await writeFile(
      join(runDir, 'threshold-dropped.json'),
      `${JSON.stringify(
        belowThreshold.map((f) => ({ id: f.id, score: f.score, title: f.title })),
        null,
        2,
      )}\n`,
    )
  }
  const coverage = await reconcileCoverage(runDir, new Set(files))
  if (coverage) {
    process.stdout.write(
      coverage.missing.length === 0
        ? `dedupe: all ${coverage.expected} expected findings files present\n`
        : `dedupe: ${coverage.missing.length} of ${coverage.expected} expected findings files missing (re-dispatch those specialists): ${coverage.missing.join(', ')}\n`,
    )
  }
  await logLine(runDir, {
    stage: 'dedupe',
    status: 'done',
    input: collected.length,
    output: aboveThreshold.length,
    threshold,
    threshold_dropped: belowThreshold.length,
    evidence: {
      skipped: evidence.skipped,
      dropped: evidence.dropped.length,
    },
    ...(coverage ? { coverage } : {}),
  })
  return 0
}
