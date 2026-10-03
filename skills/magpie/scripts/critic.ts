import { join } from 'node:path'
import { scoreRisk } from './score.ts'
import {
  ACTIONS,
  CONFIDENCES,
  deriveSeverity,
  IMPACTS,
  LIKELIHOODS,
  type ReviewFinding,
  type ReviewRule,
  type Risk,
} from './types.ts'

export const DEFAULT_BATCH_SIZE = 30
export const DEFAULT_DESIGN_CAP = 3

const DESIGN_DOMAINS = new Set(['code-smells', 'architecture'])

export const CRITIC_PLACEHOLDERS = [
  '<<CANDIDATES>>',
  '<<MERGE_CANDIDATES>>',
  '<<REVIEW_RULES>>',
  '<<WORKTREE>>',
  '<<DIFF_PATH>>',
  '<<OUTPUT_PATH>>',
] as const

const PLACEHOLDER_PATTERN = new RegExp(CRITIC_PLACEHOLDERS.join('|'), 'g')

export type CriticVerdict = {
  id: string
  verdict: 'keep' | 'drop' | 'merge'
  reason: string
  mergeInto?: string
  risk?: Risk
  checked: string[]
}

function isValidRisk(raw: unknown): raw is Risk {
  if (!raw || typeof raw !== 'object') return false
  const r = raw as Record<string, unknown>
  return (
    (IMPACTS as readonly unknown[]).includes(r.impact) &&
    (LIKELIHOODS as readonly unknown[]).includes(r.likelihood) &&
    (CONFIDENCES as readonly unknown[]).includes(r.confidence) &&
    (ACTIONS as readonly unknown[]).includes(r.action)
  )
}

/**
 * Structural check of a critic output file. Risk values are passed through
 * unchecked because `applyCriticVerdicts` reports invalid risk per id.
 */
export function parseCriticVerdicts(raw: unknown, source: string): CriticVerdict[] {
  if (!Array.isArray(raw)) throw new Error(`${source}: expected a JSON array of verdicts`)
  return raw.map((entry, i) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`${source}: verdict ${i} is not an object`)
    }
    const e = entry as Record<string, unknown>
    if (typeof e.id !== 'string') throw new Error(`${source}: verdict ${i} has no string id`)
    if (e.verdict !== 'keep' && e.verdict !== 'drop' && e.verdict !== 'merge') {
      throw new Error(`${source}: verdict for ${e.id} must be keep, drop or merge`)
    }
    if (typeof e.reason !== 'string') {
      throw new Error(`${source}: verdict for ${e.id} has no string reason`)
    }
    if (!Array.isArray(e.checked) || !e.checked.every((c) => typeof c === 'string')) {
      throw new Error(`${source}: verdict for ${e.id} needs checked as an array of strings`)
    }
    return {
      id: e.id,
      verdict: e.verdict,
      reason: e.reason,
      ...(typeof e.mergeInto === 'string' ? { mergeInto: e.mergeInto } : {}),
      ...(e.risk !== undefined ? { risk: e.risk as Risk } : {}),
      checked: e.checked as string[],
    }
  })
}

export function applyCriticVerdicts(input: {
  candidates: ReviewFinding[]
  verdicts: CriticVerdict[]
  designCap: number
}): {
  kept: ReviewFinding[]
  dropped: Array<{ id: string; reason: string }>
  merged: number
  capped: number
} {
  const { candidates, verdicts, designCap } = input
  const candidateIds = new Set(candidates.map((c) => c.id))
  const byId = new Map<string, CriticVerdict>()
  const duplicates = new Set<string>()
  const unknown: string[] = []
  for (const v of verdicts) {
    if (!candidateIds.has(v.id)) unknown.push(v.id)
    if (byId.has(v.id)) duplicates.add(v.id)
    byId.set(v.id, v)
  }
  const missing = candidates.filter((c) => !byId.has(c.id)).map((c) => c.id)
  const badRisk = verdicts
    .filter((v) => v.verdict === 'keep' && !isValidRisk(v.risk))
    .map((v) => v.id)
  const badMerge = verdicts
    .filter(
      (v) =>
        v.verdict === 'merge' &&
        (v.mergeInto === undefined || byId.get(v.mergeInto)?.verdict !== 'keep'),
    )
    .map((v) => v.id)

  const problems = [
    missing.length > 0 ? `no verdict for: ${missing.join(', ')}` : null,
    unknown.length > 0 ? `verdict for unknown id: ${unknown.join(', ')}` : null,
    duplicates.size > 0 ? `more than one verdict for: ${[...duplicates].join(', ')}` : null,
    badRisk.length > 0 ? `keep without a valid risk: ${badRisk.join(', ')}` : null,
    badMerge.length > 0 ? `merge without a kept mergeInto target: ${badMerge.join(', ')}` : null,
  ].filter((p): p is string => p !== null)
  if (problems.length > 0) throw new Error(`critic verdicts rejected; ${problems.join('; ')}`)

  const keptById = new Map<string, ReviewFinding>()
  const dropped: Array<{ id: string; reason: string }> = []
  let merged = 0
  for (const candidate of candidates) {
    const v = byId.get(candidate.id) as CriticVerdict
    if (v.verdict === 'keep') {
      const critic = v.risk as Risk
      // A high-confidence call with nothing read to back it is a guess.
      const confidence =
        critic.confidence === 'high' && v.checked.length === 0 ? 'medium' : critic.confidence
      const risk: Risk = { ...critic, confidence }
      keptById.set(candidate.id, {
        ...candidate,
        risk,
        severity: deriveSeverity(risk),
        score: scoreRisk(risk),
      })
    } else if (v.verdict === 'drop') {
      dropped.push({ id: candidate.id, reason: v.reason })
    }
  }
  const absorbedBy = new Map<string, string[]>()
  for (const candidate of candidates) {
    const v = byId.get(candidate.id) as CriticVerdict
    if (v.verdict !== 'merge') continue
    const targetId = v.mergeInto as string
    absorbedBy.set(targetId, [...(absorbedBy.get(targetId) ?? []), candidate.id])
    const target = keptById.get(targetId) as ReviewFinding
    keptById.set(targetId, {
      ...target,
      mergedFrom: [
        ...(target.mergedFrom ?? []),
        { domain: (candidate.domain as string) ?? 'unknown', title: candidate.title },
      ],
    })
    merged++
  }

  const design = [...keptById.values()].filter((f) => DESIGN_DOMAINS.has(f.domain ?? ''))
  // Array.prototype.sort is stable, so equal scores keep input order.
  const overCap = [...design]
    .sort((a, b) => (b.score as number) - (a.score as number))
    .slice(Math.max(designCap, 0))
  const cappedIds = new Set(overCap.map((f) => f.id))
  for (const f of design) {
    if (!cappedIds.has(f.id)) continue
    dropped.push({ id: f.id, reason: 'design-cap' })
    for (const sourceId of absorbedBy.get(f.id) ?? []) {
      dropped.push({ id: sourceId, reason: `design-cap (merged into ${f.id})` })
    }
  }
  const kept = [...keptById.values()].filter((f) => !cappedIds.has(f.id))
  return { kept, dropped, merged, capped: cappedIds.size }
}

/**
 * Greedy batches in input order. A merge group rides along with its first
 * member so the critic that sees one half of a group sees all of it.
 */
function batchCandidates(
  candidates: ReviewFinding[],
  groups: string[][],
  batchSize: number,
): ReviewFinding[][] {
  const byId = new Map(candidates.map((c) => [c.id, c]))
  const groupOf = new Map<string, string[]>()
  for (const group of groups) {
    for (const id of group) if (!groupOf.has(id)) groupOf.set(id, group)
  }
  const placed = new Set<string>()
  const batches: ReviewFinding[][] = []
  let current: ReviewFinding[] = []
  for (const candidate of candidates) {
    if (placed.has(candidate.id)) continue
    if (current.length >= batchSize) {
      batches.push(current)
      current = []
    }
    for (const id of groupOf.get(candidate.id) ?? [candidate.id]) {
      const member = byId.get(id)
      if (!member || placed.has(id)) continue
      current.push(member)
      placed.add(id)
    }
  }
  if (current.length > 0) batches.push(current)
  return batches
}

function renderCandidates(batch: ReviewFinding[]): string {
  const compact = batch.map((f) => ({
    id: f.id,
    file: f.file,
    line: f.line,
    onChangedLine: f.onChangedLine,
    risk: f.risk,
    domain: f.domain,
    title: f.title,
    description: f.description,
    evidence: f.evidence,
  }))
  return JSON.stringify(compact, null, 2)
}

function renderRules(rules: ReviewRule[]): string {
  if (rules.length === 0) return '(none)'
  return rules.map((r) => `- ${r.rule} (${r.source})`).join('\n')
}

export function buildCriticPrompts(input: {
  template: string
  candidates: ReviewFinding[]
  mergeCandidates: string[][]
  reviewRules: ReviewRule[]
  worktree: string
  diffPath: string
  runDir: string
  batchSize: number
}): Array<{ batch: number; prompt: string; outputPath: string }> {
  const missing = CRITIC_PLACEHOLDERS.filter((p) => !input.template.includes(p))
  if (missing.length > 0) {
    throw new Error(`critic template is missing placeholders: ${missing.join(', ')}`)
  }
  const batches = batchCandidates(input.candidates, input.mergeCandidates, input.batchSize)
  return batches.map((batch, i) => {
    const ids = new Set(batch.map((c) => c.id))
    const groups = input.mergeCandidates.filter((g) => g.every((id) => ids.has(id)))
    const outputPath = join(
      input.runDir,
      batches.length === 1 ? 'critic.json' : `critic-${i + 1}.json`,
    )
    const values: Record<(typeof CRITIC_PLACEHOLDERS)[number], string> = {
      '<<CANDIDATES>>': renderCandidates(batch),
      '<<MERGE_CANDIDATES>>': JSON.stringify(groups, null, 2),
      '<<REVIEW_RULES>>': renderRules(input.reviewRules),
      '<<WORKTREE>>': input.worktree,
      '<<DIFF_PATH>>': input.diffPath,
      '<<OUTPUT_PATH>>': outputPath,
    }
    // One pass, so placeholder-shaped text inside a finding is never expanded,
    // and a replacer function, so `$` in finding text stays literal.
    const prompt = input.template.replace(
      PLACEHOLDER_PATTERN,
      (match) => values[match as (typeof CRITIC_PLACEHOLDERS)[number]],
    )
    return { batch: i + 1, prompt, outputPath }
  })
}
