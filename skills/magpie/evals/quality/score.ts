import { diceCoefficient, tokenize } from '../../scripts/dedupe.ts'
import type { FindingLabel } from '../../scripts/labels.ts'
import type { ReviewFinding } from '../../scripts/types.ts'

export const MATCH_LINE_RADIUS = 5
export const MATCH_MIN_DICE = 0.4

export type QualityScore = {
  kept: number
  posted: number
  postedKept: number
  dismissedKept: Record<string, number>
  precision: number | null
  recall: number | null
  byDomain: Record<string, { kept: number; postedKept: number }>
  byVia: Record<string, number>
}

// Old runs logged posts without a route; the key says so instead of guessing one.
const NO_VIA = 'unrecorded'
const NO_DOMAIN = 'unassigned'

/**
 * `findings` is the candidate pool the selection was made from. Only posted
 * labels on ids in that pool count toward recall, so a finding the selection
 * could never have kept (a peer-review addition, say) is not held against it.
 */
export function scoreSelection(input: {
  labels: FindingLabel[]
  keptIds: string[]
  findings: ReviewFinding[]
}): QualityScore {
  const labelById = new Map(input.labels.map((l) => [l.id, l]))
  const findingById = new Map(input.findings.map((f) => [f.id, f]))

  let labelledKept = 0
  let postedKept = 0
  const dismissedKept: Record<string, number> = {}
  const byDomain: Record<string, { kept: number; postedKept: number }> = {}
  const byVia: Record<string, number> = {}

  for (const id of input.keptIds) {
    const finding = findingById.get(id)
    if (!finding) throw new Error(`kept id ${id} is not among the scored findings`)
    const domain = finding.domain ?? NO_DOMAIN
    const domainCounts = byDomain[domain] ?? { kept: 0, postedKept: 0 }
    byDomain[domain] = domainCounts
    domainCounts.kept++

    const label = labelById.get(id)
    if (!label) continue
    labelledKept++
    if (label.label === 'posted') {
      postedKept++
      domainCounts.postedKept++
      const via = label.via ?? NO_VIA
      byVia[via] = (byVia[via] ?? 0) + 1
    } else if (label.label === 'dismissed') {
      if (!label.reason) throw new Error(`dismissed label for ${id} has no reason`)
      dismissedKept[label.reason] = (dismissedKept[label.reason] ?? 0) + 1
    }
  }

  const posted = input.labels.filter((l) => l.label === 'posted' && findingById.has(l.id)).length
  return {
    kept: input.keptIds.length,
    posted,
    postedKept,
    dismissedKept,
    precision: labelledKept === 0 ? null : postedKept / labelledKept,
    recall: posted === 0 ? null : postedKept / posted,
    byDomain,
    byVia,
  }
}

// Two file-level findings (line null) sit at the same place; a file-level
// finding never matches an anchored one.
function lineDistance(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0
  if (a === null || b === null) return Number.POSITIVE_INFINITY
  return Math.abs(a - b)
}

/**
 * Maps each new finding id to the labelled finding id it re-discovers. Pairs are
 * assigned best Dice first, so when two new findings compete for one labelled
 * finding the closer title wins, and each side is matched at most once.
 */
export function matchFindings(
  newFindings: ReviewFinding[],
  labelled: ReviewFinding[],
): Map<string, string> {
  const pairs: Array<{ newId: string; labelledId: string; dice: number }> = []
  for (const n of newFindings) {
    const nTokens = tokenize(n.title)
    for (const l of labelled) {
      if (n.file !== l.file) continue
      if (lineDistance(n.line, l.line) > MATCH_LINE_RADIUS) continue
      const dice = diceCoefficient(nTokens, tokenize(l.title))
      if (dice >= MATCH_MIN_DICE) pairs.push({ newId: n.id, labelledId: l.id, dice })
    }
  }
  // Array.prototype.sort is stable, so equal Dice keeps input order.
  pairs.sort((a, b) => b.dice - a.dice)
  const matches = new Map<string, string>()
  const usedLabelled = new Set<string>()
  for (const p of pairs) {
    if (matches.has(p.newId) || usedLabelled.has(p.labelledId)) continue
    matches.set(p.newId, p.labelledId)
    usedLabelled.add(p.labelledId)
  }
  return matches
}

/**
 * Scores a full-pipeline replay, whose findings carry fresh ids. Each new kept
 * finding takes the id of the labelled finding it matches; the rest are
 * prefixed so a fresh id that happens to equal a labelled one (`bugs-1`) is
 * never mistaken for it, and they stay out of precision as unlabelled.
 */
export function scoreReplay(input: {
  labels: FindingLabel[]
  labelled: ReviewFinding[]
  newKept: ReviewFinding[]
}): { score: QualityScore; unlabelled: number; matches: Map<string, string> } {
  const matches = matchFindings(input.newKept, input.labelled)
  const unmatched = input.newKept
    .filter((f) => !matches.has(f.id))
    .map((f) => ({ ...f, id: `unmatched:${f.id}` }))
  const score = scoreSelection({
    labels: input.labels,
    keptIds: input.newKept.map((f) => matches.get(f.id) ?? `unmatched:${f.id}`),
    findings: [...input.labelled, ...unmatched],
  })
  return { score, unlabelled: unmatched.length, matches }
}

/**
 * Pools several runs into one scoring input. Ids are prefixed with the run id
 * because finding ids like `bugs-1` repeat across runs.
 */
export function poolRuns(
  runs: Array<{
    runId: string
    labels: FindingLabel[]
    keptIds: string[]
    findings: ReviewFinding[]
  }>,
): { labels: FindingLabel[]; keptIds: string[]; findings: ReviewFinding[] } {
  const key = (runId: string, id: string) => `${runId}/${id}`
  return {
    labels: runs.flatMap((r) => r.labels.map((l) => ({ ...l, id: key(r.runId, l.id) }))),
    keptIds: runs.flatMap((r) => r.keptIds.map((id) => key(r.runId, id))),
    findings: runs.flatMap((r) => r.findings.map((f) => ({ ...f, id: key(r.runId, f.id) }))),
  }
}

/** `--name value` flags; a flag given without a value is an error, not a boolean. */
export function parseFlags(argv: string[], known: string[]): Record<string, string> {
  const flags: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string
    const name = arg.replace(/^--/, '')
    if (!arg.startsWith('--') || !known.includes(name)) {
      throw new Error(`unknown argument ${arg} (known: ${known.map((k) => `--${k}`).join(', ')})`)
    }
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`)
    flags[name] = value
    i++
  }
  return flags
}

export function positiveNumberFlag(flags: Record<string, string>, name: string): number | null {
  const raw = flags[name]
  if (raw === undefined) return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) throw new Error(`--${name} ${raw}: want a positive number`)
  return n
}

export function formatRatio(value: number | null): string {
  return value === null ? '-' : value.toFixed(2)
}

export function resultTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-')
}

/**
 * Reads `claude -p --output-format json` stdout. A run that ended in error
 * (a spent budget, say) is checked through `is_error` as well as the exit code.
 * Cost is null when the CLI did not report one.
 */
export function parseClaudeResult(stdout: string, label: string): { costUsd: number | null } {
  let result: Record<string, unknown>
  try {
    result = JSON.parse(stdout) as Record<string, unknown>
  } catch {
    throw new Error(`${label}: claude printed no JSON result: ${stdout.slice(0, 200)}`)
  }
  if (result.is_error === true) {
    throw new Error(
      `${label}: claude ended in error (${String(result.subtype)}): ${String(result.result)}`,
    )
  }
  return { costUsd: typeof result.total_cost_usd === 'number' ? result.total_cost_usd : null }
}
