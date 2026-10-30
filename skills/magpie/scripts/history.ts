import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PrActivity } from './pr-activity.ts'
import type { PreviousFindings } from './previous-findings.ts'

export type HistoryIncremental = {
  previousSha: string
  changedSincePrevious: string[] | null
}

export type History = {
  activity: PrActivity | null
  previous: PreviousFindings | null
  incremental: HistoryIncremental | null
}

const MAX_BODY = 280

// Conclusions that mean the check found something; CANCELLED and SKIPPED say nothing about the code.
const FAILING = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'])

function flatten(body: string): string {
  const text = body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > MAX_BODY ? `${text.slice(0, MAX_BODY)}…` : text
}

function location(file: string, line: number | null): string {
  return line === null ? file : `${file}:${line}`
}

function section(heading: string, lines: string[]): string[] {
  return lines.length === 0 ? [] : [`${heading}:`, ...lines]
}

function joinSections(sections: string[][]): string {
  return sections
    .filter((s) => s.length > 0)
    .map((s) => s.join('\n'))
    .join('\n\n')
}

// The account GitHub Actions posts as: coverage tables, deploy previews and other
// CI output, which reaches the review as checks. Review bots post as their own
// apps, and what they raise still counts. gh prints the login without `[bot]`,
// the REST API with it.
const CI_AUTHORS = new Set(['github-actions', 'github-actions[bot]'])

function raisedSections(input: Pick<History, 'activity' | 'previous'>): string[][] {
  const threads = (input.activity?.threads ?? [])
    .filter((t) => !t.resolved)
    .map((t) => {
      const who = t.magpie ? 'magpie, earlier run' : `${t.author}, ${t.replies} replies`
      const outdated = t.outdated ? ' [outdated]' : ''
      return `- ${location(t.file, t.line)} (${who})${outdated}: ${flatten(t.body)}`
    })
  const comments = (input.activity?.comments ?? [])
    .filter((c) => !CI_AUTHORS.has(c.author))
    .map((c) => `- ${c.magpie ? 'magpie, earlier run' : c.author}: ${flatten(c.body)}`)
  const dismissed = (input.previous?.findings ?? []).flatMap((f) =>
    f.label === 'dismissed' ? [`- ${location(f.file, f.line)} [${f.reason}]: ${f.title}`] : [],
  )
  return [
    section('Open review threads', threads),
    section('PR comments', comments),
    section('Dismissed by the reviewer in an earlier magpie run', dismissed),
  ]
}

/** What the critic weighs a candidate against for the "already raised" drop. */
export function renderAlreadyRaised(input: Pick<History, 'activity' | 'previous'>): string {
  return joinSections(raisedSections(input)) || '(none)'
}

/** The specialists' "Already on this PR" prompt part; empty when there is nothing to say. */
export function renderHistory(history: History): string {
  const checks = (history.activity?.checks ?? [])
    .filter((c) => FAILING.has(c.conclusion))
    .map((c) => `- ${c.name}: ${c.conclusion}${c.url ? ` (${c.url})` : ''}`)
  const changed = history.incremental?.changedSincePrevious ?? []
  const sinceHeading = history.incremental
    ? `Files changed since the last review at ${history.incremental.previousSha.slice(0, 7)} (the whole diff is still your scope)`
    : ''
  const raised = joinSections(raisedSections(history))
  const leads = joinSections([
    section('Failing CI checks (a lead to investigate, not a finding in itself)', checks),
    section(
      sinceHeading,
      changed.map((f) => `- ${f}`),
    ),
  ])
  if (raised === '' && leads === '') return ''
  const parts = ['## Already on this PR']
  if (raised !== '') {
    parts.push(
      'The threads, comments and dismissals below were raised before this review. Do not report a finding that repeats one of them: the critic drops repeats. Report it again only when you have something material it lacks, and say what that is.',
      raised,
    )
  }
  if (leads !== '') {
    parts.push('Leads, not repeats: a finding that explains one of these is wanted.', leads)
  }
  return parts.join('\n\n')
}

async function readSidecar<T>(runDir: string, name: string): Promise<T | null> {
  const path = join(runDir, name)
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null
    throw err
  }
  try {
    return JSON.parse(text) as T
  } catch (err) {
    throw new Error(`${path}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** Each sidecar is optional: local runs, first runs and runs from older versions lack them. */
export async function readHistory(runDir: string): Promise<History> {
  const incremental = await readSidecar<{
    previousSha?: unknown
    changedSincePrevious?: unknown
  }>(runDir, 'incremental.json')
  return {
    activity: await readSidecar<PrActivity>(runDir, 'pr-activity.json'),
    previous: await readSidecar<PreviousFindings>(runDir, 'previous-findings.json'),
    incremental:
      incremental && typeof incremental.previousSha === 'string'
        ? {
            previousSha: incremental.previousSha,
            changedSincePrevious: Array.isArray(incremental.changedSincePrevious)
              ? (incremental.changedSincePrevious as string[])
              : null,
          }
        : null,
  }
}
