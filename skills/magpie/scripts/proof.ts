import { join } from 'node:path'
import { scoreRisk } from './score.ts'
import { isRepro, type Repro, type ReviewFinding } from './types.ts'

/** Each proof is one subagent writing and running a test, so the count is the cost. */
export const DEFAULT_PROOF_CAP = 8

export const PROOF_PLACEHOLDERS = [
  '<<FINDING>>',
  '<<WORKTREE>>',
  '<<DIFF_PATH>>',
  '<<OUTPUT_PATH>>',
] as const

const PLACEHOLDER_PATTERN = new RegExp(PROOF_PLACEHOLDERS.join('|'), 'g')

// The id names the prompt and output files.
const SAFE_ID = /^[A-Za-z0-9_-]+$/

const OUTCOMES = ['reproduced', 'disproved', 'not-proven'] as const

export type ProofResult =
  | { id: string; outcome: 'reproduced' | 'disproved'; reason: string; repro: Repro }
  | { id: string; outcome: 'not-proven'; reason: string }

export type ProofDropped = {
  id: string
  file: string
  line: number | null
  title: string
  reason: string
  repro: Repro
}

export function selectForProof(findings: ReviewFinding[], cap: number): ReviewFinding[] {
  const eligible = findings.filter(
    (f) =>
      (f.risk.impact === 'critical' || f.risk.impact === 'high') &&
      (f.risk.action === 'must-fix' || f.risk.action === 'should-fix'),
  )
  // Scored from risk here, not read from `score`: the peer reviewer may have
  // changed risk or added findings after dedupe set it.
  return [...eligible].sort((a, b) => scoreRisk(b.risk) - scoreRisk(a.risk)).slice(0, cap)
}

export function buildProofPrompts(input: {
  template: string
  findings: ReviewFinding[]
  worktree: string
  diffPath: string
  runDir: string
}): Array<{ id: string; prompt: string; outputPath: string }> {
  const { template, findings, worktree, diffPath, runDir } = input
  const missing = PROOF_PLACEHOLDERS.filter((p) => !template.includes(p))
  if (missing.length > 0) {
    throw new Error(`proof template is missing placeholders: ${missing.join(', ')}`)
  }
  return findings.map((f) => {
    if (!SAFE_ID.test(f.id)) throw new Error(`finding id ${f.id} is not safe in a file name`)
    const outputPath = join(runDir, `proof-${f.id}.json`)
    const finding = JSON.stringify(
      {
        id: f.id,
        file: f.file,
        line: f.line,
        risk: f.risk,
        domain: f.domain,
        title: f.title,
        description: f.description,
        evidence: f.evidence,
      },
      null,
      2,
    )
    const values: Record<(typeof PROOF_PLACEHOLDERS)[number], string> = {
      '<<FINDING>>': finding,
      '<<WORKTREE>>': worktree,
      '<<DIFF_PATH>>': diffPath,
      '<<OUTPUT_PATH>>': outputPath,
    }
    // A function replacer, so `$` in a finding's text is not read as a pattern.
    const prompt = template.replace(PLACEHOLDER_PATTERN, (m) => values[m as keyof typeof values])
    return { id: f.id, prompt, outputPath }
  })
}

export function parseProofResult(raw: unknown, source: string): ProofResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${source}: expected a JSON object`)
  }
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string') throw new Error(`${source}: id must be a string`)
  if (typeof r.reason !== 'string' || r.reason === '') {
    throw new Error(`${source}: reason must be a non-empty string`)
  }
  if (!(OUTCOMES as readonly unknown[]).includes(r.outcome)) {
    throw new Error(`${source}: outcome must be reproduced, disproved or not-proven`)
  }
  if (r.outcome === 'not-proven') return { id: r.id, outcome: 'not-proven', reason: r.reason }
  const outcome = r.outcome as 'reproduced' | 'disproved'
  if (!isRepro(r.repro)) {
    throw new Error(`${source}: ${outcome} needs a repro with path, command, source and output`)
  }
  const { path, command, source: code, output } = r.repro
  return {
    id: r.id,
    outcome,
    reason: r.reason,
    repro: { path, command, source: code, output },
  }
}

export function applyProofResults(input: { findings: ReviewFinding[]; results: ProofResult[] }): {
  findings: ReviewFinding[]
  dropped: ProofDropped[]
} {
  const ids = new Set(input.findings.map((f) => f.id))
  const unknown = input.results.filter((r) => !ids.has(r.id)).map((r) => r.id)
  if (unknown.length > 0) throw new Error(`proof result for unknown id: ${unknown.join(', ')}`)
  const byId = new Map(input.results.map((r) => [r.id, r]))
  const findings: ReviewFinding[] = []
  const dropped: ProofDropped[] = []
  for (const f of input.findings) {
    const r = byId.get(f.id)
    if (r === undefined) {
      findings.push(f)
    } else if (r.outcome === 'disproved') {
      dropped.push({
        id: f.id,
        file: f.file,
        line: f.line,
        title: f.title,
        reason: r.reason,
        repro: r.repro,
      })
    } else if (r.outcome === 'not-proven') {
      findings.push({ ...f, proof: { status: 'not-proven', reason: r.reason } })
    } else {
      // A failing test that shows the defect leaves nothing to be unsure of.
      const risk = { ...f.risk, confidence: 'high' as const }
      findings.push({
        ...f,
        risk,
        score: scoreRisk(risk),
        proof: { status: 'reproduced', reason: r.reason, repro: r.repro },
      })
    }
  }
  return { findings, dropped }
}
