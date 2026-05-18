import { readdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { type PostStatusMap, renderFindingsToDisk } from './render-findings.ts'
import { renderProgressToDisk } from './render-progress.ts'
import { parseFinding } from './types.ts'

async function nextVersionedPath(screenDir: string, base: string): Promise<string> {
  const entries: string[] = await readdir(screenDir).catch(() => [] as string[])
  if (!entries.includes(`${base}.html`)) return join(screenDir, `${base}.html`)
  let n = 2
  while (entries.includes(`${base}-v${n}.html`)) n++
  return join(screenDir, `${base}-v${n}.html`)
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return (await Bun.file(path).json()) as T
  } catch {
    return fallback
  }
}

async function readLog(runDir: string): Promise<Array<Record<string, unknown>>> {
  const text = await readFile(join(runDir, 'log.jsonl'), 'utf8').catch(() => '')
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>
      } catch {
        return { stage: 'unknown', status: 'parse-error' } as Record<string, unknown>
      }
    })
}

function summarizeStages(log: Array<Record<string, unknown>>): {
  stages: Record<string, 'pending' | 'running' | 'done' | 'error' | 'skipped'>
  specialistCounts: Record<string, number>
} {
  const stages: Record<string, 'pending' | 'running' | 'done' | 'error' | 'skipped'> = {
    setup: 'pending',
    context: 'pending',
    specialists: 'pending',
    dedupe: 'pending',
    critic: 'pending',
    'peer-review': 'pending',
    report: 'pending',
    post: 'pending',
  }
  const specialistCounts: Record<string, number> = {
    security: 0,
    bugs: 0,
    performance: 0,
    'code-smells': 0,
    architecture: 0,
  }
  for (const entry of log) {
    const stage = entry.stage as string
    const status = entry.status as string
    if (stage in stages && status === 'done') stages[stage] = 'done'
    if (stage in stages && status === 'running') stages[stage] = 'running'
    if (stage in stages && status === 'error') stages[stage] = 'error'
    if (stage in stages && status === 'skipped') stages[stage] = 'skipped'
    if (stage === 'specialist' && typeof entry.focus === 'string') {
      if (entry.focus in specialistCounts && typeof entry.findings === 'number') {
        specialistCounts[entry.focus] = entry.findings
      }
    }
  }
  return { stages, specialistCounts }
}

export async function runRender(runDir: string, page: 'progress' | 'findings'): Promise<number> {
  const screenDir = join(runDir, 'screen')
  if (page === 'progress') {
    const prJson = await readJson<Record<string, unknown>>(join(runDir, 'pr.json'), {
      number: 0,
      headRefName: '?',
      headRefOid: '?',
    })
    const log = await readLog(runDir)
    const summary = summarizeStages(log)
    const outPath = await nextVersionedPath(screenDir, 'progress')
    await renderProgressToDisk(
      {
        prNumber: Number(prJson.number ?? 0),
        headSha: String(prJson.headRefOid ?? '?'),
        branch: String(prJson.headRefName ?? '?'),
        stages: summary.stages as never,
        specialistCounts: summary.specialistCounts,
      },
      outPath,
    )
    return 0
  }

  const findings = (await readJson<unknown[]>(join(runDir, 'findings.final.json'), [])).map((raw) =>
    parseFinding(raw),
  )
  const postStatus = await readJson<PostStatusMap>(join(runDir, 'post-status.json'), {})
  const prJson = await readJson<Record<string, unknown>>(join(runDir, 'pr.json'), {})
  const prNumber = Number(prJson.number ?? 0)
  const pr =
    prNumber > 0
      ? {
          number: prNumber,
          branch: String(prJson.headRefName ?? '?'),
          headSha: String(prJson.headRefOid ?? '?'),
        }
      : undefined
  const outPath = await nextVersionedPath(screenDir, 'findings')
  await renderFindingsToDisk({ findings, postStatus, runId: basename(runDir), pr }, outPath)
  return 0
}
