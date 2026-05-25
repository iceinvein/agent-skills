import { appendFile, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { deduplicateFindings } from './dedupe.ts'
import { verifyEvidence } from './evidence-filter.ts'
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
    const focus = name.slice(0, -'.json'.length)
    if (!FOCUS_IDS.includes(focus as (typeof FOCUS_IDS)[number])) {
      await logLine(runDir, {
        stage: 'dedupe',
        status: 'skip',
        reason: 'unknown-focus',
        file: name,
      })
      continue
    }
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
        collected.push(parseFinding(item))
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
  const aboveThreshold = evidence.kept.filter((f) => (f.score ?? 0) >= threshold)
  const belowThreshold = evidence.kept.filter((f) => (f.score ?? 0) < threshold)
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
  })
  return 0
}
