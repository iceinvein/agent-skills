import { createHash } from 'node:crypto'
import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildNewSideLineIndex } from './diff-utils.ts'
import { formatFindingDescriptionMarkdown } from './finding-description.ts'
import {
  type FocusId,
  type PrFileEntry,
  parseFinding,
  type ReviewFinding,
  type Severity,
} from './types.ts'

export type PostInput = {
  runDir: string
  findingIds: string[]
  ghBin?: string
  /** Skip the actual gh invocation; useful for tests. Records would-be commands instead. */
  dryRun?: boolean
  /**
   * Whether to also post a top-level review-summary comment before the
   * per-finding posts.
   * - 'auto' (default): post when this batch has at least one finding and no
   *   summary has been posted before. Always-on UX.
   * - 'always': post even on empty batches (clean-review comment).
   * - 'never': skip the summary entirely.
   */
  includeSummary?: 'auto' | 'always' | 'never'
}

export type PostResult = {
  id: string
  status: 'posted' | 'failed' | 'unknown-id' | 'already-posted'
  message?: string
  command?: string[]
}

export type PostOutcome = {
  ok: boolean
  results: PostResult[]
  /** Owner/name for the target PR, parsed from pr.json url. */
  target?: { repo: string; number: number }
  /** When a precondition failed (no pr.json, missing fields), describe it here. */
  error?: string
}

export function parseRepoFromUrl(url: string): string | null {
  // https://github.com/<owner>/<repo>/pull/<n> -> "<owner>/<repo>"
  const m = url.match(/github\.com\/([^/]+\/[^/]+)\/pull\/\d+/)
  return m ? (m[1] ?? null) : null
}

const SEVERITY_ICON: Record<Severity, string> = {
  blocker: '🔴',
  high: '🟠',
  medium: '🟡',
  low: '⚪',
}

const SEVERITY_LABEL: Record<Severity, string> = {
  blocker: 'Blocker',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

const FOCUS_LABEL: Record<FocusId, string> = {
  security: 'Security',
  bugs: 'Bugs',
  performance: 'Performance',
  'code-smells': 'Code Smells',
  architecture: 'Architecture',
  tests: 'Tests',
}

function formatFocus(f: ReviewFinding): string | null {
  if (!f.domain) return null
  return FOCUS_LABEL[f.domain as FocusId] ?? f.domain
}

function buildMetaLine(parts: Array<string | false | null | undefined>): string | null {
  const filtered = parts.filter((p): p is string => typeof p === 'string' && p.length > 0)
  if (filtered.length === 0) return null
  return `<sub>${filtered.join(' · ')}</sub>`
}

function buildRiskParts(f: ReviewFinding): string[] {
  return [
    `Impact · ${f.risk.impact}`,
    `Likelihood · ${f.risk.likelihood}`,
    `Confidence · ${f.risk.confidence}`,
    `Action · ${f.risk.action}`,
  ]
}

function maxBacktickRun(s: string): number {
  let max = 0
  for (const m of s.matchAll(/`+/g)) {
    if (m[0].length > max) max = m[0].length
  }
  return max
}

/**
 * Pull a single fenced code block out of a suggestion body, returning its code
 * plus any surrounding prose. LLMs sometimes wrap the real replacement in
 * ```lang ... ``` with explanatory text around it; if that nested fence leaks
 * into the outer ```suggestion``` wrapper it breaks GitHub's renderer and
 * causes downstream markdown (e.g. the magpie:finding HTML marker) to spill
 * into a stray code block. We hoist the inner code out so the suggestion body
 * contains only what should be committed.
 */
function splitEmbeddedFence(
  body: string,
): { code: string; preamble: string; postamble: string } | null {
  const re = /(?:^|\n)(`{3,})[^\n`]*\n([\s\S]*?)\n\1(?=\n|$)/
  const match = body.match(re)
  if (match?.index === undefined) return null
  const code = match[2] ?? ''
  const matchStart = match.index + (body[match.index] === '\n' ? 1 : 0)
  const matchEnd = matchStart + match[0].length - (body[match.index] === '\n' ? 1 : 0)
  return {
    code,
    preamble: body.slice(0, matchStart).trim(),
    postamble: body.slice(matchEnd).trim(),
  }
}

type SuggestionParts = {
  block: string | null
  preamble: string | null
  postamble: string | null
}

function buildSuggestion(f: ReviewFinding): SuggestionParts {
  const raw = f.suggestion?.body.trim()
  if (!raw) return { block: null, preamble: null, postamble: null }
  const split = splitEmbeddedFence(raw)
  const code = split?.code ?? raw
  const fenceLen = Math.max(3, maxBacktickRun(code) + 1)
  const fence = '`'.repeat(fenceLen)
  return {
    block: `${fence}suggestion\n${code}\n${fence}`,
    preamble: split?.preamble || null,
    postamble: split?.postamble || null,
  }
}

function buildFindingMarker(f: ReviewFinding): string {
  const normalized = JSON.stringify({
    file: f.file || '',
    line: f.line ?? null,
    severity: f.severity,
    risk: f.risk,
    title: f.title.trim(),
    description: f.description.trim(),
    suggestion: f.suggestion ?? null,
  })
  const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 16)
  const id = f.id.replace(/[^a-zA-Z0-9_-]/g, '')
  return `<!-- magpie:finding id=${id} hash=${hash} -->`
}

function joinBlock(parts: Array<string | null | undefined>): string {
  return parts.filter((p): p is string => typeof p === 'string').join('\n')
}

/**
 * Inline review-thread body. Anchored to a specific RIGHT-side line, so we can
 * include a ```suggestion block that GitHub renders as one-click apply.
 */
export function formatInlineBody(f: ReviewFinding): string {
  const icon = SEVERITY_ICON[f.severity]
  const label = SEVERITY_LABEL[f.severity]
  const focus = formatFocus(f)
  const metaLine = buildMetaLine([...buildRiskParts(f), focus ? `Focus · ${focus}` : null])
  const { block: suggestion, preamble: sugPre, postamble: sugPost } = buildSuggestion(f)
  const sections = formatFindingDescriptionMarkdown(f.description)

  return joinBlock([
    `### ${icon} ${label}: ${f.title}`,
    metaLine ? '' : null,
    metaLine,
    '',
    sections,
    sugPre ? '' : null,
    sugPre,
    suggestion ? '' : null,
    suggestion,
    sugPost ? '' : null,
    sugPost,
    '',
    buildFindingMarker(f),
  ])
}

/**
 * Top-level PR conversation body. Used for findings without a diff anchor and
 * as the fallback when GitHub refuses an inline comment (line not in diff).
 */
export function formatConversationBody(f: ReviewFinding): string {
  const icon = SEVERITY_ICON[f.severity]
  const label = SEVERITY_LABEL[f.severity]
  const focus = formatFocus(f)
  const location = f.file ? `\`${f.file}${f.line != null ? `:${f.line}` : ''}\`` : null
  const metaLine = buildMetaLine([
    location ? `Location · ${location}` : null,
    focus ? `Focus · ${focus}` : null,
    ...buildRiskParts(f),
  ])
  const sections = formatFindingDescriptionMarkdown(f.description)
  const { block: suggestion, preamble: sugPre, postamble: sugPost } = buildSuggestion(f)

  return joinBlock([
    `### ${icon} ${label}: ${f.title}`,
    metaLine ? '' : null,
    metaLine,
    '',
    sections,
    sugPre ? '' : null,
    sugPre,
    suggestion ? '' : null,
    suggestion,
    sugPost ? '' : null,
    sugPost,
    '',
    buildFindingMarker(f),
  ])
}

/**
 * Backwards-compatible entry point. Dispatches to the inline body when the
 * finding has a line anchor, conversation body otherwise.
 */
export function formatPostBody(f: ReviewFinding): string {
  return f.line != null ? formatInlineBody(f) : formatConversationBody(f)
}

const SEVERITY_ORDER: Severity[] = ['blocker', 'high', 'medium', 'low']

const SUMMARY_MARKER = '<!-- magpie:summary -->'

function plural(n: number, singular: string, pluralForm?: string): string {
  return `${n} ${n === 1 ? singular : (pluralForm ?? `${singular}s`)}`
}

function formatLocation(f: ReviewFinding): string {
  if (!f.file) return ''
  return `\`${f.file}${f.line != null ? `:${f.line}` : ''}\``
}

export type ReviewSummaryOptions = {
  /** Optional commit SHA. When present, surfaces a "Reviewed at <sha>" trailer. */
  commitId?: string
  /** PR files changed (from pr.json). Used for the walkthrough table and effort score. */
  files?: PrFileEntry[]
  /** Incremental review context. When present, surfaces "since <prev-sha>" trailer. */
  incremental?: { previousSha: string; sameSha: boolean }
}

/** Effort score 1 (trivial) to 5 (substantial), derived from changed files and lines. */
export function computeEffortScore(files: PrFileEntry[]): number {
  if (files.length === 0) return 1
  const lines = files.reduce((acc, f) => acc + f.additions + f.deletions, 0)
  if (files.length <= 2 && lines <= 50) return 1
  if (files.length <= 5 && lines <= 200) return 2
  if (files.length <= 10 && lines <= 500) return 3
  if (files.length <= 20 && lines <= 1000) return 4
  return 5
}

function renderEffortBar(score: number): string {
  const filled = '●'.repeat(score)
  const empty = '○'.repeat(Math.max(0, 5 - score))
  return `${filled}${empty}`
}

function findingsByFile(findings: ReviewFinding[]): Map<string, ReviewFinding[]> {
  const map = new Map<string, ReviewFinding[]>()
  for (const f of findings) {
    if (!f.file) continue
    const list = map.get(f.file)
    if (list) list.push(f)
    else map.set(f.file, [f])
  }
  return map
}

function renderWalkthroughTable(
  files: PrFileEntry[],
  byFile: Map<string, ReviewFinding[]>,
): string[] {
  if (files.length === 0) return []
  const sorted = [...files].sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions))
  const top = sorted.slice(0, 20)
  const lines = [
    '',
    `<details>`,
    `<summary><b>Files changed</b> (${plural(files.length, 'file')}${files.length > top.length ? `, showing top ${top.length}` : ''})</summary>`,
    '',
    '| File | +/- | Findings |',
    '|---|---|---|',
  ]
  for (const f of top) {
    const finds = byFile.get(f.path)?.length ?? 0
    const stats = `+${f.additions} / -${f.deletions}`
    lines.push(`| \`${f.path}\` | ${stats} | ${finds || ''} |`)
  }
  lines.push('', '</details>')
  return lines
}

function renderRiskHotspots(byFile: Map<string, ReviewFinding[]>): string[] {
  const entries = [...byFile.entries()]
    .map(([file, finds]) => ({ file, finds }))
    .filter((e) => e.finds.length >= 2)
    .sort((a, b) => b.finds.length - a.finds.length)
    .slice(0, 3)
  if (entries.length === 0) return []
  const lines = ['', '### Risk hotspots', '']
  for (const e of entries) {
    const counts: Record<Severity, number> = { blocker: 0, high: 0, medium: 0, low: 0 }
    for (const f of e.finds) counts[f.severity] += 1
    const tally = SEVERITY_ORDER.filter((s) => counts[s] > 0)
      .map((s) => `${SEVERITY_ICON[s]} ${counts[s]}`)
      .join(' · ')
    lines.push(`- \`${e.file}\` · ${plural(e.finds.length, 'finding')} · ${tally}`)
  }
  return lines
}

/**
 * Top-level review summary body. A verdict line, file scope, "Needs
 * Attention" top 3, and a collapsible risk breakdown. Posted once per batch
 * as a top-level PR comment so the conversation has a coherent overview
 * alongside the per-finding threads.
 */
export function formatReviewSummaryBody(
  findings: ReviewFinding[],
  options: ReviewSummaryOptions = {},
): string {
  const counts: Record<Severity, number> = { blocker: 0, high: 0, medium: 0, low: 0 }
  for (const f of findings) counts[f.severity]++

  const inlineFindings = findings.filter((f) => f.file && f.line != null)
  const unanchoredFindings = findings.filter((f) => !f.file || f.line == null)

  const fileCount = new Set(inlineFindings.map((f) => f.file)).size
  const shortSha = options.commitId ? options.commitId.slice(0, 7) : ''
  const files = options.files ?? []
  const effort = computeEffortScore(files)
  const byFile = findingsByFile(findings)

  let verdict: string
  if (counts.blocker > 0) {
    verdict = `⚠️ **${plural(counts.blocker, 'blocking issue')}**`
  } else if (counts.high > 0) {
    verdict = `⚠️ **${plural(counts.high, 'high-risk item')} to review**`
  } else if (findings.length > 0) {
    verdict = `💡 **${plural(findings.length, 'finding')}**`
  } else {
    verdict = '✅ **No issues found.**'
  }

  const scope = findings.length > 0 && fileCount > 0 ? ` across ${plural(fileCount, 'file')}.` : ''
  const sha = shortSha ? ` Reviewed at \`${shortSha}\`.` : ''
  const header = `${verdict}${scope}${sha}`.replace(/\s+$/, '')

  const lines: string[] = [header]

  if (files.length > 0) {
    lines.push('', `<sub>Review effort · ${renderEffortBar(effort)} (${effort}/5)</sub>`)
  }

  if (options.incremental) {
    const prevShort = options.incremental.previousSha.slice(0, 7)
    const msg = options.incremental.sameSha
      ? `Re-review (no new commits since \`${prevShort}\`)`
      : `Incremental review since \`${prevShort}\``
    lines.push('', `<sub>${msg}</sub>`)
  }

  if (findings.length > 0) {
    const inlineText =
      inlineFindings.length > 0
        ? `Posted ${plural(inlineFindings.length, 'inline thread')}.`
        : 'No inline threads were posted.'
    const summaryText =
      unanchoredFindings.length > 0
        ? ` ${plural(unanchoredFindings.length, 'finding')} ${
            unanchoredFindings.length === 1 ? 'is' : 'are'
          } listed at the conversation level.`
        : ''
    lines.push('', `${inlineText}${summaryText}`)
  }

  const topFindings = [...findings]
    .filter((f) => f.severity === 'blocker' || f.severity === 'high')
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity))
    .slice(0, 3)

  if (topFindings.length > 0) {
    lines.push('', '### Needs Attention', '')
    for (const f of topFindings) {
      const icon = SEVERITY_ICON[f.severity]
      const label = SEVERITY_LABEL[f.severity]
      const loc = formatLocation(f)
      const focus = formatFocus(f)
      const meta = [loc, focus].filter(Boolean).join(' · ')
      lines.push(`- ${icon} **${label}: ${f.title}**${meta ? ` · ${meta}` : ''}`)
    }
  }

  lines.push(...renderRiskHotspots(byFile))
  lines.push(...renderWalkthroughTable(files, byFile))

  if (findings.length > 0) {
    lines.push(
      '',
      '<details>',
      `<summary><b>Risk breakdown</b> (${plural(findings.length, 'finding')})</summary>`,
      '',
      '| Severity | Count |',
      '|---|---|',
    )
    for (const sev of SEVERITY_ORDER) {
      if (counts[sev] > 0) {
        lines.push(`| ${SEVERITY_ICON[sev]} ${SEVERITY_LABEL[sev]} | ${counts[sev]} |`)
      }
    }
    lines.push('', '</details>')
  }

  lines.push('', SUMMARY_MARKER)

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// postFindingsAsReview
// ---------------------------------------------------------------------------

export type PostReviewInput = {
  runDir: string
  findingIds: string[]
  prNumber: number
  headSha: string
  /**
   * Target repo as "owner/name". When omitted, the `{owner}/{repo}` gh
   * placeholder is used, which resolves from the gh process's cwd. The server
   * always passes this explicitly so the call does not depend on cwd.
   */
  repo?: string
  reviewBody?: string
  ghBin?: string
  dryRun?: boolean
}

export type PostReviewCommentResult = {
  id: string
  status: 'posted' | 'failed'
  message?: string
}

export type PostReviewResult = {
  reviewId: string | null
  comments: PostReviewCommentResult[]
  command?: string[]
  payload?: string
}

// Looser finding shape used only inside postFindingsAsReview to accommodate
// findings.json entries where `file` may be null (not yet anchored to a path).
type LooseFinding = {
  id: string
  file: string | null
  line: number | null
  title: string
  description: string
}

function parseLooseFinding(raw: unknown): LooseFinding | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string') return null
  if (typeof r.title !== 'string') return null
  if (typeof r.description !== 'string') return null
  const file = typeof r.file === 'string' ? r.file : null
  const line = typeof r.line === 'number' ? r.line : null
  return { id: r.id, file, line, title: r.title, description: r.description }
}

export async function postFindingsAsReview(input: PostReviewInput): Promise<PostReviewResult> {
  const bin = input.ghBin ?? process.env.MAGPIE_GH_BIN ?? 'gh'

  // Load findings.json and index by id. Use a loose parser that tolerates
  // null file/line fields which parseFinding (strict) would reject.
  const byId = new Map<string, LooseFinding>()
  try {
    const raw = JSON.parse(await readFile(join(input.runDir, 'findings.json'), 'utf8'))
    if (Array.isArray(raw)) {
      for (const entry of raw) {
        const f = parseLooseFinding(entry)
        if (f) byId.set(f.id, f)
      }
    }
  } catch {
    // findings.json missing or unparseable; byId stays empty
  }

  // Also load findings.final.json so we can use strict ReviewFinding formatters.
  const strictById = new Map<string, ReviewFinding>()
  try {
    const raw = JSON.parse(await readFile(join(input.runDir, 'findings.final.json'), 'utf8'))
    if (Array.isArray(raw)) {
      for (const entry of raw) {
        try {
          const f = parseFinding(entry)
          strictById.set(f.id, f)
        } catch {
          // entry doesn't pass strict validation; will fall back to LooseFinding path
        }
      }
    }
  } catch {
    // findings.final.json missing or unparseable; strictById stays empty
  }

  // Build the set of (file, RIGHT-side line) pairs GitHub will accept as inline
  // anchors. Inline comments on lines outside this set get 422'd and would
  // poison the whole batch; instead we demote them to the review body.
  let validRightLines: Map<string, Set<number>> | null = null
  try {
    const diff = await readFile(join(input.runDir, 'diff.patch'), 'utf8')
    validRightLines = buildNewSideLineIndex(diff)
  } catch {
    // diff.patch absent (archived/legacy runs); skip validation and trust caller.
    validRightLines = null
  }

  // Partition into inline (has file + line in diff) and unplaced (everything else).
  type InlineComment = { path: string; line: number; side: 'RIGHT'; body: string }
  const inlineComments: InlineComment[] = []
  const unplacedBodies: string[] = []
  const demotedIds: string[] = []

  for (const id of input.findingIds) {
    const strict = strictById.get(id)
    const f =
      byId.get(id) ??
      (strict
        ? {
            id: strict.id,
            file: strict.file,
            line: strict.line,
            title: strict.title,
            description: strict.description,
          }
        : null)
    if (!f) continue
    const lineInDiff =
      f.line != null &&
      f.file != null &&
      (validRightLines == null || validRightLines.get(f.file)?.has(f.line) === true)
    if (lineInDiff) {
      const body = strict
        ? formatInlineBody(strict)
        : formatFindingDescriptionMarkdown(f.description)
      inlineComments.push({
        path: f.file as string,
        line: f.line as number,
        side: 'RIGHT',
        body,
      })
    } else if (f.line != null && f.file != null) {
      demotedIds.push(id)
      const anchor = `\`${f.file}:${f.line}\` (anchor not in PR diff, posted in review body)`
      const inner = strict
        ? formatConversationBody(strict)
        : `**${f.title}**\n\n${formatFindingDescriptionMarkdown(f.description)}`
      unplacedBodies.push(`${anchor}\n\n${inner}`)
    } else {
      const body = strict
        ? formatConversationBody(strict)
        : `**${f.title}** (${f.file ?? 'general'})\n\n${formatFindingDescriptionMarkdown(f.description)}`
      unplacedBodies.push(body)
    }
  }

  // Build review body.
  const unplacedSection = unplacedBodies.join('\n\n---\n\n')
  const reviewBodyParts = [input.reviewBody, unplacedSection].filter(
    (s): s is string => typeof s === 'string' && s.length > 0,
  )
  const reviewBody = reviewBodyParts.join('\n\n')

  const payloadObj = {
    commit_id: input.headSha,
    event: 'COMMENT',
    body: reviewBody,
    comments: inlineComments,
  }
  const payload = JSON.stringify(payloadObj)

  const repoSlug = input.repo ?? '{owner}/{repo}'
  const command = [
    bin,
    'api',
    `repos/${repoSlug}/pulls/${input.prNumber}/reviews`,
    '--method',
    'POST',
    '--input',
    '-',
  ]

  const demoted = new Set(demotedIds)
  const buildCommentResults = (status: 'posted' | 'failed', message?: string) =>
    input.findingIds.map((id) => {
      const base: PostReviewCommentResult = { id, status }
      const m =
        message ?? (demoted.has(id) ? 'anchor not in PR diff, posted in review body' : undefined)
      return m ? { ...base, message: m } : base
    })

  if (input.dryRun) {
    return {
      reviewId: null,
      comments: buildCommentResults('posted'),
      command,
      payload,
    }
  }

  // Execute.
  let stdoutText: string
  let stderrText: string
  let exit: number
  try {
    const proc = Bun.spawn(command, { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
    const stdin = proc.stdin as import('bun').FileSink
    stdin.write(payload)
    await stdin.flush()
    stdin.end()
    ;[stdoutText, stderrText, exit] = await Promise.all([
      new Response(proc.stdout as ReadableStream).text(),
      new Response(proc.stderr as ReadableStream).text(),
      proc.exited,
    ])
  } catch (err) {
    const msg = (err as Error).message ?? `cannot spawn ${bin}`
    return {
      reviewId: null,
      comments: buildCommentResults('failed', msg),
      command,
      payload,
    }
  }

  if (exit !== 0) {
    return {
      reviewId: null,
      comments: buildCommentResults('failed', stderrText.trim()),
      command,
      payload,
    }
  }

  const review = JSON.parse(stdoutText) as { id: number }
  const reviewId = String(review.id)

  // Persist to post-status.json.
  const existing = await readPostStatus(input.runDir)
  for (const id of input.findingIds) {
    existing[id] = 'posted'
  }
  existing.__lastReviewId = reviewId
  await writePostStatus(input.runDir, existing)

  return {
    reviewId,
    comments: buildCommentResults('posted'),
    command,
    payload,
  }
}

async function readPostStatus(runDir: string): Promise<Record<string, unknown>> {
  try {
    return (await Bun.file(join(runDir, 'post-status.json')).json()) as Record<string, unknown>
  } catch {
    return {}
  }
}

async function writePostStatus(runDir: string, status: Record<string, unknown>): Promise<void> {
  await writeFile(join(runDir, 'post-status.json'), `${JSON.stringify(status, null, 2)}\n`)
}

async function logEvent(runDir: string, entry: Record<string, unknown>): Promise<void> {
  await appendFile(
    join(runDir, 'log.jsonl'),
    `${JSON.stringify({ ...entry, ts: Date.now() })}\n`,
  ).catch(() => {})
}

async function runGh(
  ghBin: string,
  args: string[],
): Promise<{ exit: number; stdout: string; stderr: string }> {
  try {
    const proc = Bun.spawn([ghBin, ...args], { stdout: 'pipe', stderr: 'pipe' })
    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const exit = await proc.exited
    return { exit, stdout, stderr }
  } catch (err) {
    // gh missing from PATH or otherwise unspawnable. Treat as exit 127 with the
    // OS error as stderr, matching the shell convention.
    return { exit: 127, stdout: '', stderr: (err as Error).message ?? `cannot spawn ${ghBin}` }
  }
}

function buildInlineCommand(
  repo: string,
  prNumber: number,
  headSha: string,
  f: ReviewFinding,
  body: string,
): string[] {
  return [
    'api',
    `repos/${repo}/pulls/${prNumber}/comments`,
    '-X',
    'POST',
    '-F',
    `body=${body}`,
    '-F',
    `commit_id=${headSha}`,
    '-F',
    `path=${f.file}`,
    '-F',
    `line=${f.line}`,
    '-F',
    'side=RIGHT',
  ]
}

function buildPrCommentCommand(repo: string, prNumber: number, body: string): string[] {
  return ['pr', 'comment', String(prNumber), '--repo', repo, '--body', body]
}

function isLineNotInDiff(stderr: string): boolean {
  // GitHub returns HTTP 422 when the inline-comment line isn't part of the
  // PR diff (or the commit_id shifted). gh prints something like
  // "gh: ... (HTTP 422)" with the GitHub error body.
  return /\b422\b|Unprocessable|pull_request_review_thread|not part of the diff/i.test(stderr)
}

function buildFallbackBody(f: ReviewFinding, reason: string): string {
  const anchor = f.line != null ? `${f.file}:${f.line}` : f.file
  const conversationBody = formatConversationBody(f)
  return `> Note: \`${anchor}\` is not commentable inline (${reason}); posted as a PR comment.\n\n${conversationBody}`
}

export async function runPost(input: PostInput): Promise<PostOutcome> {
  const ghBin = input.ghBin ?? process.env.MAGPIE_GH_BIN ?? 'gh'

  // Read pr.json to learn the target PR/repo/head SHA.
  let prJson: Record<string, unknown>
  try {
    prJson = JSON.parse(await readFile(join(input.runDir, 'pr.json'), 'utf8'))
  } catch (err) {
    return { ok: false, results: [], error: `Cannot read pr.json: ${(err as Error).message}` }
  }
  const prNumber = Number(prJson.number)
  const headSha = String(prJson.headRefOid ?? '')
  const url = typeof prJson.url === 'string' ? prJson.url : ''
  const repo = url ? parseRepoFromUrl(url) : null
  if (!Number.isFinite(prNumber) || !headSha || !repo) {
    return {
      ok: false,
      results: [],
      error: `Missing PR target (number=${prNumber}, headSha=${!!headSha}, repo=${repo ?? 'unknown'}). Re-run setup to refresh pr.json.`,
    }
  }

  // Load findings.final.json and index by id.
  let findings: ReviewFinding[]
  try {
    const raw = JSON.parse(await readFile(join(input.runDir, 'findings.final.json'), 'utf8'))
    if (!Array.isArray(raw)) throw new Error('findings.final.json is not an array')
    findings = raw.map((r) => parseFinding(r))
  } catch (err) {
    return {
      ok: false,
      results: [],
      error: `Cannot read findings.final.json: ${(err as Error).message}`,
    }
  }
  const byId = new Map(findings.map((f) => [f.id, f]))

  // Inflate selected ids, preserving order.
  const status = await readPostStatus(input.runDir)
  const results: PostResult[] = []

  await logEvent(input.runDir, {
    stage: 'post',
    status: 'start',
    count: input.findingIds.length,
    target: `${repo}#${prNumber}`,
  })

  // Decide whether to post the review summary up front. It is one extra
  // top-level PR comment that gives the conversation a coherent overview
  // before the per-finding threads land. Default 'auto' fires for any
  // non-empty batch; 'always' fires even on empty batches (clean-review).
  const summaryMode = input.includeSummary ?? 'auto'
  const selectedFindings = input.findingIds
    .map((id) => byId.get(id))
    .filter((f): f is ReviewFinding => Boolean(f))
  const summaryAlreadyPosted = status.__summary__ === 'posted'
  const shouldPostSummary =
    !summaryAlreadyPosted &&
    summaryMode !== 'never' &&
    (summaryMode === 'always' || selectedFindings.length >= 1)

  const prFiles = Array.isArray(prJson.files)
    ? (prJson.files as PrFileEntry[]).filter(
        (f): f is PrFileEntry =>
          typeof f?.path === 'string' &&
          typeof f?.additions === 'number' &&
          typeof f?.deletions === 'number',
      )
    : []

  let incremental: ReviewSummaryOptions['incremental']
  try {
    const raw = await readFile(join(input.runDir, 'incremental.json'), 'utf8')
    const parsed = JSON.parse(raw) as { previousSha?: string; sameSha?: boolean }
    if (typeof parsed.previousSha === 'string') {
      incremental = { previousSha: parsed.previousSha, sameSha: Boolean(parsed.sameSha) }
    }
  } catch {
    // No incremental sidecar; first run for this PR.
  }

  if (shouldPostSummary) {
    const summaryBody = formatReviewSummaryBody(selectedFindings, {
      commitId: headSha,
      files: prFiles,
      ...(incremental ? { incremental } : {}),
    })
    const summaryCmd = buildPrCommentCommand(repo, prNumber, summaryBody)
    if (input.dryRun) {
      results.push({ id: '__summary__', status: 'posted', command: summaryCmd })
      status.__summary__ = 'posted'
      await logEvent(input.runDir, {
        stage: 'post',
        status: 'dry-run',
        id: '__summary__',
        command: summaryCmd,
      })
    } else {
      const sr = await runGh(ghBin, summaryCmd)
      if (sr.exit === 0) {
        results.push({ id: '__summary__', status: 'posted' })
        status.__summary__ = 'posted'
        await logEvent(input.runDir, { stage: 'post', status: 'ok', id: '__summary__' })
      } else {
        const msg = sr.stderr.trim() || `gh exited ${sr.exit}`
        results.push({ id: '__summary__', status: 'failed', message: msg })
        status.__summary__ = { status: 'failed', message: msg }
        await logEvent(input.runDir, {
          stage: 'post',
          status: 'failed',
          id: '__summary__',
          error: msg,
        })
      }
    }
  } else if (summaryAlreadyPosted) {
    results.push({ id: '__summary__', status: 'already-posted' })
  }

  for (const id of input.findingIds) {
    const f = byId.get(id)
    if (!f) {
      results.push({ id, status: 'unknown-id' })
      continue
    }
    if (status[id] === 'posted') {
      results.push({ id, status: 'already-posted' })
      continue
    }

    const body = formatPostBody(f)
    const inlineCmd =
      f.line != null
        ? buildInlineCommand(repo, prNumber, headSha, f, body)
        : buildPrCommentCommand(repo, prNumber, body)

    if (input.dryRun) {
      results.push({ id, status: 'posted', command: inlineCmd })
      status[id] = 'posted'
      await logEvent(input.runDir, { stage: 'post', status: 'dry-run', id, command: inlineCmd })
      continue
    }

    const r = await runGh(ghBin, inlineCmd)
    if (r.exit === 0) {
      results.push({ id, status: 'posted' })
      status[id] = 'posted'
      await logEvent(input.runDir, { stage: 'post', status: 'ok', id })
      continue
    }

    // Inline post failed. If GitHub rejected the line (422 / not in diff),
    // retry as a top-level PR comment with the anchor preserved in the body.
    // The user still gets the feedback; just at the conversation level.
    if (f.line != null && isLineNotInDiff(r.stderr)) {
      const reason = 'line not in PR diff'
      const fallbackBody = buildFallbackBody(f, reason)
      const fallbackCmd = buildPrCommentCommand(repo, prNumber, fallbackBody)
      const r2 = await runGh(ghBin, fallbackCmd)
      if (r2.exit === 0) {
        results.push({
          id,
          status: 'posted',
          message: `posted as PR comment (${reason})`,
        })
        status[id] = 'posted'
        await logEvent(input.runDir, {
          stage: 'post',
          status: 'fallback-ok',
          id,
          reason,
        })
        continue
      }
      const msg = `inline failed: ${r.stderr.trim() || `exit ${r.exit}`}; fallback also failed: ${r2.stderr.trim() || `exit ${r2.exit}`}`
      results.push({ id, status: 'failed', message: msg })
      status[id] = { status: 'failed', message: msg }
      await logEvent(input.runDir, { stage: 'post', status: 'failed', id, error: msg })
      continue
    }

    const msg = r.stderr.trim() || `gh exited ${r.exit}`
    results.push({ id, status: 'failed', message: msg })
    status[id] = { status: 'failed', message: msg }
    await logEvent(input.runDir, { stage: 'post', status: 'failed', id, error: msg })
  }

  await writePostStatus(input.runDir, status)
  return { ok: true, results, target: { repo, number: prNumber } }
}
