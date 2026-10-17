// Recall against known misses: defects a human found that magpie's kept
// findings did not raise. A model judges which kept finding, if any, describes
// each miss, because a miss is often anchored somewhere other than where a
// finding about the same defect lands.

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import type { ReviewFinding } from '../../scripts/types.ts'
import { claudeFailureMessage } from './replay-critic.ts'
import { parseClaudeResult } from './score.ts'

export const DEFAULT_JUDGE_MODEL = 'claude-sonnet-5-5'

export type Miss = {
  id: string
  file: string
  line: number | null
  title: string
  summary: string
  ownerDomain: string
  bugClass: string
  outsideDiff: boolean
  preExisting: boolean
  source: string
}

export type RecallVerdict = { missId: string; findingId: string | null; reason: string }

type Tally = { misses: number; caught: number }

export type RecallScore = {
  misses: number
  caught: number
  recall: number | null
  byDomain: Record<string, Tally>
  byClass: Record<string, Tally>
  excludingPreExisting: { misses: number; caught: number; recall: number | null }
}

const MISS_STRING_FIELDS = ['id', 'file', 'title', 'summary', 'ownerDomain', 'bugClass', 'source']
const MISS_BOOLEAN_FIELDS = ['outsideDiff', 'preExisting']

function parseMiss(raw: unknown): Miss {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('is not an object')
  }
  const entry = raw as Record<string, unknown>
  for (const field of MISS_STRING_FIELDS) {
    if (typeof entry[field] !== 'string' || entry[field] === '') {
      throw new Error(`${field} is not a non-empty string`)
    }
  }
  for (const field of MISS_BOOLEAN_FIELDS) {
    if (typeof entry[field] !== 'boolean') throw new Error(`${field} is not a boolean`)
  }
  if (entry.line !== null && !Number.isInteger(entry.line)) {
    throw new Error('line is not an integer or null')
  }
  return entry as unknown as Miss
}

/** The recall set for one run, or null when no one has written one. */
export async function loadMisses(path: string): Promise<Miss[] | null> {
  if (!existsSync(path)) return null
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(path, 'utf8'))
  } catch (err) {
    throw new Error(`${path} is not valid JSON: ${err instanceof Error ? err.message : err}`)
  }
  if (!Array.isArray(raw)) throw new Error(`${path} is not a JSON array`)
  return raw.map((m, i) => {
    try {
      return parseMiss(m)
    } catch (err) {
      throw new Error(`${path}[${i}]: ${err instanceof Error ? err.message : err}`)
    }
  })
}

function anchor(file: string, line: number | null): string {
  return line === null ? file : `${file}:${line}`
}

export function recallPrompt(misses: Miss[], findings: ReviewFinding[]): string {
  const missBlock = misses
    .map(
      (m) =>
        `- id: ${m.id}\n  at: ${anchor(m.file, m.line)}\n  title: ${m.title}\n  summary: ${m.summary}`,
    )
    .join('\n')
  const findingBlock = findings
    .map(
      (f) =>
        `- id: ${f.id}\n  at: ${anchor(f.file, f.line)}\n  title: ${f.title}\n  description: ${f.description}`,
    )
    .join('\n')
  return [
    'You judge whether a code review caught known defects.',
    '',
    'Below are MISSES, defects a human reviewer found in a pull request, and FINDINGS, the',
    'comments an automated review kept for the same pull request. For each miss, name the one',
    'finding that describes the same underlying defect, wherever that finding is anchored, or',
    'null when none does. Partial overlap that would not lead the author to the fix is null.',
    'Give a reason under 25 words for each verdict.',
    '',
    'Reply with a JSON array only, one entry per miss, each miss exactly once:',
    '[{"missId": "<miss id>", "findingId": "<finding id or null>", "reason": "<why>"}]',
    '',
    'MISSES',
    missBlock,
    '',
    'FINDINGS',
    findings.length === 0 ? '(none)' : findingBlock,
    '',
  ].join('\n')
}

const FENCED_JSON = /```json\s*\n([\s\S]*?)```/

export function parseRecallVerdicts(
  text: string,
  misses: Miss[],
  findings: ReviewFinding[],
): RecallVerdict[] {
  const body = (FENCED_JSON.exec(text)?.[1] ?? text).trim()
  let raw: unknown
  try {
    raw = JSON.parse(body)
  } catch {
    throw new Error(`recall judge printed no JSON: ${text.slice(0, 200)}`)
  }
  if (!Array.isArray(raw)) throw new Error('recall judge reply is not a JSON array')

  const missIds = new Set(misses.map((m) => m.id))
  const findingIds = new Set(findings.map((f) => f.id))
  const judged = new Set<string>()
  const verdicts = raw.map((v, i): RecallVerdict => {
    const entry = v as Record<string, unknown> | null
    if (
      typeof entry?.missId !== 'string' ||
      !(typeof entry.findingId === 'string' || entry.findingId === null) ||
      typeof entry.reason !== 'string'
    ) {
      throw new Error(`recall verdict [${i}] is not a {missId, findingId, reason} object`)
    }
    if (!missIds.has(entry.missId)) throw new Error(`recall verdict for unknown miss ${entry.missId}`)
    if (judged.has(entry.missId)) throw new Error(`miss ${entry.missId} is judged twice`)
    judged.add(entry.missId)
    if (entry.findingId !== null && !findingIds.has(entry.findingId)) {
      throw new Error(`miss ${entry.missId} names ${entry.findingId}, which is not a kept finding`)
    }
    return { missId: entry.missId, findingId: entry.findingId, reason: entry.reason }
  })
  const unjudged = misses.filter((m) => !judged.has(m.id)).map((m) => m.id)
  if (unjudged.length > 0) throw new Error(`recall judge left unjudged: ${unjudged.join(', ')}`)
  return verdicts
}

/** One `claude -p` with no tools: the judge reads only what the prompt gives it. */
export async function judgeRecall(input: {
  misses: Miss[]
  findings: ReviewFinding[]
  model: string
  cwd: string
}): Promise<{ verdicts: RecallVerdict[]; costUsd: number | null }> {
  const label = 'recall judge'
  const proc = Bun.spawn(
    ['claude', '-p', '--model', input.model, '--output-format', 'json', '--tools', ''],
    {
      cwd: input.cwd,
      stdin: new Blob([recallPrompt(input.misses, input.findings)]),
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  const [stdout, stderr, exit] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (exit !== 0) throw new Error(claudeFailureMessage(label, exit, stdout, stderr))
  const { costUsd } = parseClaudeResult(stdout, label)
  const result = (JSON.parse(stdout) as Record<string, unknown>).result
  if (typeof result !== 'string') throw new Error(`${label}: claude result is not a string`)
  return { verdicts: parseRecallVerdicts(result, input.misses, input.findings), costUsd }
}

function ratio(caught: number, misses: number): number | null {
  return misses === 0 ? null : caught / misses
}

export function scoreRecall(misses: Miss[], verdicts: RecallVerdict[]): RecallScore {
  const caughtIds = new Set(verdicts.filter((v) => v.findingId !== null).map((v) => v.missId))
  const byDomain: Record<string, Tally> = {}
  const byClass: Record<string, Tally> = {}
  let caught = 0
  let newMisses = 0
  let newCaught = 0
  for (const m of misses) {
    const isCaught = caughtIds.has(m.id)
    const domain = byDomain[m.ownerDomain] ?? { misses: 0, caught: 0 }
    byDomain[m.ownerDomain] = domain
    const bugClass = byClass[m.bugClass] ?? { misses: 0, caught: 0 }
    byClass[m.bugClass] = bugClass
    domain.misses++
    bugClass.misses++
    if (!m.preExisting) newMisses++
    if (!isCaught) continue
    caught++
    domain.caught++
    bugClass.caught++
    if (!m.preExisting) newCaught++
  }
  return {
    misses: misses.length,
    caught,
    recall: ratio(caught, misses.length),
    byDomain,
    byClass,
    excludingPreExisting: {
      misses: newMisses,
      caught: newCaught,
      recall: ratio(newCaught, newMisses),
    },
  }
}
