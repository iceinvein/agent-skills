import { readdir, readFile, unlink } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { type PostStatusMap, parseClosingIssues, renderFindingsToDisk } from './render-findings.ts'
import { type PrFileEntry, parseBrief, parseFinding } from './types.ts'

export type RefreshResult = {
  refreshed: boolean
  pruned: number
  reason?: 'no-findings-json' | 'malformed-findings-json' | 'parse-error'
}

const FINDINGS_HTML_RE = /^findings(-v\d+)?\.html$/

/**
 * Re-renders <runDir>/screen/findings.html from <runDir>/findings.final.json
 * using the currently shipped CSS/JS/template. Prunes any existing
 * findings*.html siblings so the screen dir converges on a single canonical
 * file. Safe to call against any run dir; no-ops when findings.final.json
 * is absent (e.g. during early-stage runs).
 */
export async function refreshFindings(runDir: string): Promise<RefreshResult> {
  const findingsJsonPath = join(runDir, 'findings.final.json')
  let raw: unknown
  try {
    raw = await Bun.file(findingsJsonPath).json()
  } catch {
    return { refreshed: false, pruned: 0, reason: 'no-findings-json' }
  }
  if (!Array.isArray(raw)) {
    return { refreshed: false, pruned: 0, reason: 'malformed-findings-json' }
  }

  let findings: ReturnType<typeof parseFinding>[]
  try {
    findings = raw.map((item) => parseFinding(item))
  } catch {
    return { refreshed: false, pruned: 0, reason: 'parse-error' }
  }

  const screenDir = join(runDir, 'screen')
  let pruned = 0
  try {
    const entries = await readdir(screenDir)
    for (const name of entries) {
      if (FINDINGS_HTML_RE.test(name)) {
        await unlink(join(screenDir, name)).catch(() => {})
        pruned++
      }
    }
  } catch {
    // screen dir may not exist on a brand-new rundir; renderFindingsToDisk
    // will create the path via Bun.write below.
  }

  let postStatus: PostStatusMap = {}
  try {
    postStatus = (await Bun.file(join(runDir, 'post-status.json')).json()) as PostStatusMap
  } catch {
    // optional file
  }

  let pr: { number: number; branch: string; headSha: string } | undefined
  let files: PrFileEntry[] = []
  let issues: ReturnType<typeof parseClosingIssues> = []
  try {
    const prJson = (await Bun.file(join(runDir, 'pr.json')).json()) as Record<string, unknown>
    const prNumber = Number(prJson.number ?? 0)
    if (prNumber > 0) {
      pr = {
        number: prNumber,
        branch: String(prJson.headRefName ?? '?'),
        headSha: String(prJson.headRefOid ?? '?'),
      }
    }
    const filesArray = Array.isArray(prJson.files) ? (prJson.files as unknown[]) : []
    files = filesArray.map((f) => {
      const entry = f as Record<string, unknown>
      return {
        path: String(entry.path ?? ''),
        additions: Number(entry.additions ?? 0),
        deletions: Number(entry.deletions ?? 0),
      }
    })
    issues = parseClosingIssues(prJson)
  } catch {
    // optional file; archived runs may not include pr.json
  }

  // Scout-produced summary. Same lenient-degrade contract as render-cmd.ts: a
  // missing or malformed brief.json simply omits the header rather than
  // failing the refresh (older archives predate the scout stage entirely).
  let brief: ReturnType<typeof parseBrief> | undefined
  try {
    brief = parseBrief(await Bun.file(join(runDir, 'brief.json')).json())
  } catch {
    // optional file
  }

  const diff = await readFile(join(runDir, 'diff.patch'), 'utf8').catch(() => '')

  await renderFindingsToDisk(
    {
      findings,
      postStatus,
      runId: basename(runDir),
      pr,
      files,
      diff,
      brief: brief ?? undefined,
      issues,
    },
    join(screenDir, 'findings.html'),
  )

  return { refreshed: true, pruned }
}
