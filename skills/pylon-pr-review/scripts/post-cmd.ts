import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseFinding, type ReviewFinding } from './types.ts'

export type PostInput = {
  runDir: string
  findingIds: string[]
  ghBin?: string
  /** Skip the actual gh invocation; useful for tests. Records would-be commands instead. */
  dryRun?: boolean
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

export function formatPostBody(f: ReviewFinding): string {
  const sev = `**${f.severity.toUpperCase()}**`
  const lines: string[] = [`${sev} ${f.title}`, '', f.description.trim()]
  if (f.suggestion && f.line != null) {
    // GitHub renders ```suggestion blocks as one-click apply.
    lines.push('', '```suggestion', f.suggestion.body, '```')
  } else if (f.suggestion) {
    lines.push('', '```', f.suggestion.body, '```')
  }
  return lines.join('\n')
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

function buildCommand(
  repo: string,
  prNumber: number,
  headSha: string,
  f: ReviewFinding,
  body: string,
): string[] {
  if (f.line != null) {
    // Inline review comment on the PR.
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
  // Top-level PR comment (no anchor).
  return ['pr', 'comment', String(prNumber), '--repo', repo, '--body', body]
}

export async function runPost(input: PostInput): Promise<PostOutcome> {
  const ghBin = input.ghBin ?? process.env.PR_REVIEW_GH_BIN ?? 'gh'

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
    const cmd = buildCommand(repo, prNumber, headSha, f, body)

    if (input.dryRun) {
      results.push({ id, status: 'posted', command: cmd })
      status[id] = 'posted'
      await logEvent(input.runDir, { stage: 'post', status: 'dry-run', id, command: cmd })
      continue
    }

    const r = await runGh(ghBin, cmd)
    if (r.exit !== 0) {
      const msg = r.stderr.trim() || `gh exited ${r.exit}`
      results.push({ id, status: 'failed', message: msg })
      status[id] = { status: 'failed', message: msg }
      await logEvent(input.runDir, { stage: 'post', status: 'failed', id, error: msg })
    } else {
      results.push({ id, status: 'posted' })
      status[id] = 'posted'
      await logEvent(input.runDir, { stage: 'post', status: 'ok', id })
    }
  }

  await writePostStatus(input.runDir, status)
  return { ok: true, results, target: { repo, number: prNumber } }
}
