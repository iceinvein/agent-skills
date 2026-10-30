import { existsSync } from 'node:fs'
import { appendFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { formatFindingDescriptionMarkdown } from './finding-description.ts'
import { diffSha256, localBranchDiff } from './local-diff.ts'
import { rankActionable } from './render-issues-list.ts'
import { readTarget } from './target.ts'
import { isSuggestion, parseFinding, type ReviewFinding, type Suggestion } from './types.ts'

async function logLine(runDir: string, entry: Record<string, unknown>): Promise<void> {
  const line = `${JSON.stringify({ ...entry, ts: Date.now() })}\n`
  await appendFile(join(runDir, 'log.jsonl'), line)
}

export type FormatHandoffInput = {
  target: string
  findings: ReviewFinding[]
  stale: boolean
}

/** A fence longer than any backtick run in the body, so the body cannot close it early. */
function fenceFor(body: string): string {
  const longestRun = Math.max(0, ...(body.match(/`+/g) ?? []).map((run) => run.length))
  return '`'.repeat(Math.max(3, longestRun + 1))
}

function formatSuggestion(s: Suggestion): string {
  const lines =
    s.startLine === s.endLine ? `line ${s.startLine}` : `lines ${s.startLine}-${s.endLine}`
  const fence = fenceFor(s.body)
  return `Suggested replacement for ${lines}:\n${fence}\n${s.body}\n${fence}`
}

function formatProof(f: ReviewFinding): string | null {
  if (f.proof?.status === 'not-proven') return `Not proven: ${f.proof.reason}`
  if (f.proof?.status !== 'reproduced') return null
  const { command, source } = f.proof.repro
  const fence = fenceFor(source)
  return `Reproduced with \`${command}\`:\n${fence}\n${source}\n${fence}`
}

function formatItem(n: number, f: ReviewFinding): string {
  const anchor = f.line === null ? f.file : `${f.file}:${f.line}`
  const parts = [`${n}. [${f.risk.action}] ${anchor}: ${f.title}`]
  const body = formatFindingDescriptionMarkdown(f.description)
  if (body) parts.push(body)
  if (f.suggestion) parts.push(formatSuggestion(f.suggestion))
  const proof = formatProof(f)
  if (proof) parts.push(proof)
  return parts.join('\n\n')
}

export function formatHandoff(input: FormatHandoffInput): string {
  const { target, findings, stale } = input
  const header = [`# magpie local review: ${target}`]
  if (stale) {
    header.push('Warning: the tree changed since this review began; line anchors may be off.')
  }
  if (findings.length === 0) return `${header.join('\n')}\n\nNo findings.\n`

  const mustFix = findings.filter((f) => f.risk.action === 'must-fix').length
  const shouldFix = findings.filter((f) => f.risk.action === 'should-fix').length
  const optional = findings.filter(isSuggestion).length
  // topN covers every finding, so nothing folds and the order is score alone.
  const { recommended } = rankActionable(findings, {}, new Map(), findings.length)
  const ordered = [...recommended, ...findings.filter(isSuggestion)]

  const sections = [
    header.join('\n'),
    `${mustFix} must-fix, ${shouldFix} should-fix, ${optional} optional`,
    ...ordered.map((f, i) => formatItem(i + 1, f)),
    'Address every must-fix and should-fix, or say why not. The rest are optional.',
  ]
  return `${sections.join('\n\n')}\n`
}

async function readFindings(path: string): Promise<ReviewFinding[]> {
  const raw: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (!Array.isArray(raw)) throw new Error(`${path}: expected an array of findings`)
  return raw.map(parseFinding)
}

async function readLocalMeta(path: string): Promise<{ branch: string | null; baseRef: string }> {
  const raw: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (typeof raw !== 'object' || raw === null) throw new Error(`${path}: expected an object`)
  const { branch, baseRef } = raw as Record<string, unknown>
  if (typeof baseRef !== 'string') {
    throw new Error(`${path}: baseRef must be a string, got ${JSON.stringify(baseRef)}`)
  }
  if (branch !== null && typeof branch !== 'string') {
    throw new Error(`${path}: branch must be a string or null, got ${JSON.stringify(branch)}`)
  }
  return { branch, baseRef }
}

/** The recorded sha is of the raw diff the review started from; a missing one cannot vouch for freshness. */
async function recordedDiffSha(runDir: string): Promise<string | null> {
  const path = join(runDir, 'diff-source.json')
  if (!existsSync(path)) return null
  const raw: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (typeof raw !== 'object' || raw === null) return null
  const { diffSha256: sha } = raw as Record<string, unknown>
  return typeof sha === 'string' ? sha : null
}

export async function runHandoff(runDir: string, opts: { gitBin?: string } = {}): Promise<number> {
  const gitBin = opts.gitBin ?? 'git'
  const target = await readTarget(runDir)
  if (target.mode !== 'local') {
    process.stderr.write(`magpie: handoff only applies to local runs; ${runDir} is a PR run\n`)
    return 2
  }
  const findingsPath = join(runDir, 'findings.final.json')
  const metaPath = join(runDir, 'local.json')
  for (const path of [findingsPath, metaPath]) {
    if (!existsSync(path)) {
      process.stderr.write(`magpie: handoff: ${path} is missing\n`)
      return 4
    }
  }
  const findings = await readFindings(findingsPath)
  const meta = await readLocalMeta(metaPath)

  const recorded = await recordedDiffSha(runDir)
  // A failed recompute proves nothing about the tree, so it is reported as stale.
  let currentSha: string | null = null
  try {
    const current = await localBranchDiff({ gitBin, repoPath: target.root, baseRef: meta.baseRef })
    if (current.ok) currentSha = diffSha256(current.diff)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    process.stderr.write(`magpie: handoff: could not recompute the diff: ${message}\n`)
  }
  const stale = recorded === null || currentSha === null || currentSha !== recorded

  const subject = meta.branch === null ? 'detached HEAD' : `local branch ${meta.branch}`
  process.stdout.write(
    formatHandoff({ target: `${subject} against ${meta.baseRef}`, findings, stale }),
  )
  await logLine(runDir, { stage: 'handoff', status: 'done', findings: findings.length })
  return 0
}
