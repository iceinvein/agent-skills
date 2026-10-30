import { existsSync } from 'node:fs'
import { appendFile, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { annotateChangedLines } from './changed-lines.ts'
import { deduplicateFindings, findMergeCandidates } from './dedupe.ts'
import { verifyEvidence } from './evidence-filter.ts'
import { namespaceId, parseFindingsFilename } from './findings-files.ts'
import { DEFAULT_THRESHOLD, scoreRisk } from './score.ts'
import { readShardCoverage } from './shard-coverage.ts'
import { readTarget } from './target.ts'
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
 * The five focuses a specialist subagent writes per shard. `tests` and `checks`
 * are `FOCUS_IDS` entries too, but each is written once for the whole run
 * (`tests.json` by setup, `checks.json` by the stage 3 checks pass), so neither
 * is ever expected per shard.
 */
const SPECIALIST_FOCUS_IDS = FOCUS_IDS.filter((id) => id !== 'tests' && id !== 'checks')

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
  // A shard skipped at the stage 4 gate has no findings by design, and the report says so.
  const skipped = new Set((await readShardCoverage(runDir))?.skipped.map((s) => s.id))
  const expected: string[] = []
  for (const [i, shard] of shards.entries()) {
    const id = typeof shard?.id === 'number' ? shard.id : i + 1
    if (skipped.has(id)) continue
    for (const focus of SPECIALIST_FOCUS_IDS) {
      expected.push(sharded ? `${focus}.shard-${id}.json` : `${focus}.json`)
    }
  }
  return { expected: expected.length, missing: expected.filter((name) => !present.has(name)) }
}

export async function runDedupe(runDir: string, options: RunDedupeOptions = {}): Promise<number> {
  const target = await readTarget(runDir)
  // A missing PR worktree means an archived run and evidence checks are skipped; a
  // missing local root means the caller's repo moved or was mistyped.
  if (target.mode === 'local' && !existsSync(target.root)) {
    process.stderr.write(`magpie: dedupe: review root ${target.root} does not exist\n`)
    return 1
  }
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
  const evidence = await verifyEvidence(scored, target.root)
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
  await writeFile(
    join(runDir, 'merge-candidates.json'),
    `${JSON.stringify(findMergeCandidates(aboveThreshold), null, 2)}\n`,
  )
  // A sidecar left from an earlier run would describe drops this run did not make.
  if (evidence.dropped.length > 0 || evidence.reanchored.length > 0) {
    await writeFile(
      join(runDir, 'evidence-dropped.json'),
      `${JSON.stringify({ dropped: evidence.dropped, reanchored: evidence.reanchored }, null, 2)}\n`,
    )
  } else {
    await rm(join(runDir, 'evidence-dropped.json'), { force: true })
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
  } else {
    await rm(join(runDir, 'threshold-dropped.json'), { force: true })
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
      reanchored: evidence.reanchored.length,
    },
    ...(coverage ? { coverage } : {}),
  })
  return 0
}
