import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { containsEvidence } from './evidence-filter.ts'
import { DISMISS_REASONS, type DismissReason, type FindingLabel } from './labels.ts'
import { readRunLabels } from './labels-cmd.ts'
import { parseFinding } from './types.ts'

type PreviousFindingBase = {
  id: string
  /** The run that produced the finding, which can be older than the previous run when carried. */
  fromRunId: string
  file: string
  line: number | null
  title: string
  domain: string | null
}

/**
 * `anchor` says whether the code the finding quoted is still in the file. It
 * does not say the finding was fixed: the code can change and keep the defect.
 */
export type PreviousFinding =
  | (PreviousFindingBase & { label: 'posted'; anchor: 'unchanged' | 'changed' | 'unanchored' })
  | (PreviousFindingBase & { label: 'dismissed'; reason: DismissReason })

export type PreviousFindings = {
  previousRunId: string
  findings: PreviousFinding[]
}

function isMissingFile(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === 'ENOENT'
}

async function readOptionalJson(path: string): Promise<unknown | null> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (err) {
    if (isMissingFile(err)) return null
    throw err
  }
  try {
    return JSON.parse(text)
  } catch (err) {
    throw new Error(`${path}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** cleanup writes labels.json before archiving; an active run's labels are folded fresh. */
async function readLabels(runDir: string): Promise<FindingLabel[]> {
  const path = join(runDir, 'labels.json')
  const raw = await readOptionalJson(path)
  if (raw === null) return readRunLabels(runDir)
  if (!Array.isArray(raw)) throw new Error(`${path}: expected a JSON array`)
  return raw as FindingLabel[]
}

async function anchorStatus(
  worktree: string,
  file: string,
  line: number | null,
  evidence: string | undefined,
): Promise<'unchanged' | 'changed' | 'unanchored'> {
  if (line === null || !evidence?.trim()) return 'unanchored'
  let text: string
  try {
    text = await readFile(join(worktree, file), 'utf8')
  } catch (err) {
    if (isMissingFile(err)) return 'changed'
    throw err
  }
  return containsEvidence(text, evidence) ? 'unchanged' : 'changed'
}

/**
 * Dismissals only travel one run at a time: a finding the critic dropped as
 * already dismissed never reaches findings.final.json, so the next run would
 * forget it unless the previous run's own carried dismissals come along too.
 */
function parseCarried(raw: unknown, path: string): PreviousFinding[] {
  if (raw === null) return []
  const findings = (raw as { findings?: unknown }).findings
  if (!Array.isArray(findings)) throw new Error(`${path}: expected { findings: [...] }`)
  return findings.flatMap((entry, i) => {
    const f = entry as Record<string, unknown>
    if (f.label !== 'dismissed') return []
    const reason = DISMISS_REASONS.find((r) => r === f.reason)
    if (
      typeof f.id !== 'string' ||
      typeof f.fromRunId !== 'string' ||
      typeof f.file !== 'string' ||
      typeof f.title !== 'string' ||
      !reason
    ) {
      throw new Error(`${path}: findings[${i}] is not a dismissed finding`)
    }
    return [
      {
        id: f.id,
        fromRunId: f.fromRunId,
        file: f.file,
        line: typeof f.line === 'number' ? f.line : null,
        title: f.title,
        domain: typeof f.domain === 'string' ? f.domain : null,
        label: 'dismissed' as const,
        reason,
      },
    ]
  })
}

/**
 * The previous run's posted and dismissed findings, for a re-review to carry
 * forward. Ignored findings are left out: nobody judged them. A run aborted
 * before findings.final.json still passes on what it carried. Null when it has
 * neither.
 */
export async function readPreviousFindings(input: {
  runDir: string
  runId: string
  worktree: string
}): Promise<PreviousFindings | null> {
  const finalPath = join(input.runDir, 'findings.final.json')
  const raw = await readOptionalJson(finalPath)
  const carriedPath = join(input.runDir, 'previous-findings.json')
  const carriedRaw = await readOptionalJson(carriedPath)
  if (raw === null && carriedRaw === null) return null
  if (raw !== null && !Array.isArray(raw)) throw new Error(`${finalPath}: expected a JSON array`)
  const labels =
    raw === null ? new Map() : new Map((await readLabels(input.runDir)).map((l) => [l.id, l]))

  const findings: PreviousFinding[] = []
  for (const entry of raw ?? []) {
    const f = parseFinding(entry)
    const label = labels.get(f.id)
    const base = {
      id: f.id,
      fromRunId: input.runId,
      file: f.file,
      line: f.line,
      title: f.title,
      domain: typeof f.domain === 'string' ? f.domain : null,
    }
    if (label?.label === 'posted') {
      const anchor = await anchorStatus(input.worktree, f.file, f.line, f.evidence)
      findings.push({ ...base, label: 'posted', anchor })
    } else if (label?.label === 'dismissed' && label.reason) {
      findings.push({ ...base, label: 'dismissed', reason: label.reason })
    }
  }

  const carried = parseCarried(carriedRaw, carriedPath)
  const seen = new Set(findings.map((f) => `${f.fromRunId}/${f.id}`))
  for (const f of carried) {
    if (!seen.has(`${f.fromRunId}/${f.id}`)) findings.push(f)
  }
  return { previousRunId: input.runId, findings }
}

export async function writePreviousFindings(
  runDir: string,
  previous: PreviousFindings,
): Promise<void> {
  await writeFile(join(runDir, 'previous-findings.json'), `${JSON.stringify(previous, null, 2)}\n`)
}

/** One line for the report header and the summary comment; null when nothing was posted last review. */
export function describePreviousPosted(previous: PreviousFindings): string | null {
  const posted = previous.findings.flatMap((f) => (f.label === 'posted' ? [f] : []))
  if (posted.length === 0) return null
  const count = (anchor: string) => posted.filter((f) => f.anchor === anchor).length
  const parts = [
    `Last review: ${posted.length} posted`,
    `${count('changed')} on changed code`,
    `${count('unchanged')} on unchanged code`,
  ]
  const unanchored = count('unanchored')
  if (unanchored > 0) parts.push(`${unanchored} not anchored to a line`)
  return parts.join(' · ')
}
