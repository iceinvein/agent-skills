import { appendFile, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { deduplicateFindings } from './dedupe.ts'
import { FOCUS_IDS, parseFinding, type ReviewFinding } from './types.ts'

async function logLine(runDir: string, entry: Record<string, unknown>): Promise<void> {
  const line = `${JSON.stringify({ ...entry, ts: Date.now() })}\n`
  await appendFile(join(runDir, 'log.jsonl'), line)
}

export async function runDedupe(runDir: string): Promise<number> {
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
  await writeFile(join(runDir, 'findings.deduped.json'), `${JSON.stringify(deduped, null, 2)}\n`)
  await logLine(runDir, {
    stage: 'dedupe',
    status: 'done',
    input: collected.length,
    output: deduped.length,
  })
  return 0
}
