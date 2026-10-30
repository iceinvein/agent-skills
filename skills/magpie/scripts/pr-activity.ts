import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export type PrCheck = {
  name: string
  /** CheckRun conclusion, or its status while it has none; StatusContext state. Upper case as GitHub sends it. */
  conclusion: string
  url: string | null
}

export type PrThread = {
  file: string
  line: number | null
  resolved: boolean
  outdated: boolean
  author: string
  /** The thread's first comment. */
  body: string
  replies: number
  /** Posted by magpie in an earlier run, recognised by its hidden marker. */
  magpie: boolean
}

export type PrComment = {
  author: string
  body: string
  magpie: boolean
}

export type PrActivity = {
  checks: PrCheck[]
  threads: PrThread[]
  comments: PrComment[]
}

export type FetchPrActivityInput = {
  ghBin: string
  prNumber: number
  /** pr.json's `url`, the source of owner and repo for the thread query. */
  prUrl: string
  runDir: string
  cwd?: string
  env?: Record<string, string>
}

export type FetchPrActivityResult =
  | { ok: true; activity: PrActivity }
  | { ok: false; error: string }

const ACTIVITY_VIEW_FIELDS = 'statusCheckRollup,comments,reviews'

const FINDING_MARKER = '<!-- magpie:finding'
const SUMMARY_MARKER = '<!-- magpie:summary -->'
const REVIEW_BODY_SEPARATOR = '\n\n---\n\n'

// gh pr view does not expose review threads, which carry the file, line and
// resolved state, so they come from GraphQL a page at a time.
const THREADS_QUERY = `query($owner: String!, $repo: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          path line originalLine isResolved isOutdated
          comments(first: 1) { totalCount nodes { author { login } body } }
        }
      }
    }
  }
}`

type GhRun = { ok: true; stdout: string } | { ok: false; error: string }

async function runGh(input: FetchPrActivityInput, args: string[]): Promise<GhRun> {
  const proc = Bun.spawn([input.ghBin, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    ...(input.cwd ? { cwd: input.cwd } : {}),
    ...(input.env ? { env: { ...process.env, ...input.env } } : {}),
  })
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  const exit = await proc.exited
  if (exit !== 0)
    return { ok: false, error: `gh ${args[0]} ${args[1]} exit ${exit}: ${stderr.trim()}` }
  return { ok: true, stdout }
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

// GitHub returns a null author for a deleted account and shows it as "ghost".
function login(author: unknown): string {
  return author === null ? 'ghost' : str((author as { login?: unknown }).login)
}

function parseChecks(rollup: unknown): PrCheck[] {
  if (!Array.isArray(rollup)) return []
  return rollup.map((raw) => {
    const c = raw as Record<string, unknown>
    if (c.__typename === 'StatusContext') {
      return { name: str(c.context), conclusion: str(c.state), url: str(c.targetUrl) || null }
    }
    return {
      name: str(c.name),
      conclusion: str(c.conclusion) || str(c.status),
      url: str(c.detailsUrl) || null,
    }
  })
}

function parseComments(view: Record<string, unknown>): PrComment[] {
  const entries = [
    ...(Array.isArray(view.comments) ? view.comments : []),
    ...(Array.isArray(view.reviews) ? view.reviews : []),
  ] as Array<Record<string, unknown>>
  // The report's Post Selected joins findings with no inline anchor into one
  // review body; split it so each one is its own entry rather than one cut short.
  return entries
    .flatMap((e) =>
      str(e.body)
        .split(REVIEW_BODY_SEPARATOR)
        .map((body) => ({ author: login(e.author), body })),
    )
    .filter((c) => c.body.trim() !== '' && !c.body.includes(SUMMARY_MARKER))
    .map((c) => ({ ...c, magpie: c.body.includes(FINDING_MARKER) }))
}

/** Null for a thread whose opening comment was deleted: it has nothing left to repeat. */
function parseThread(raw: unknown): PrThread | null {
  const t = raw as Record<string, unknown>
  const comments = (t.comments ?? {}) as { totalCount?: unknown; nodes?: unknown }
  const first = (Array.isArray(comments.nodes) ? comments.nodes[0] : undefined) as
    | Record<string, unknown>
    | undefined
  const body = str(first?.body)
  if (!first || body.trim() === '') return null
  const total = typeof comments.totalCount === 'number' ? comments.totalCount : 0
  // An outdated thread has no current line; where it was first left is still the best pointer.
  const line =
    typeof t.line === 'number' ? t.line : typeof t.originalLine === 'number' ? t.originalLine : null
  return {
    file: str(t.path),
    line,
    resolved: t.isResolved === true,
    outdated: t.isOutdated === true,
    author: login(first.author),
    body,
    replies: Math.max(total - 1, 0),
    magpie: body.includes(FINDING_MARKER),
  }
}

async function fetchThreads(
  input: FetchPrActivityInput,
  owner: string,
  repo: string,
): Promise<{ ok: true; threads: PrThread[] } | { ok: false; error: string }> {
  const threads: PrThread[] = []
  let after: string | null = null
  do {
    const args = [
      'api',
      'graphql',
      '-f',
      `query=${THREADS_QUERY}`,
      '-f',
      `owner=${owner}`,
      '-f',
      `repo=${repo}`,
      '-F',
      `number=${input.prNumber}`,
      ...(after ? ['-f', `after=${after}`] : []),
    ]
    const run = await runGh(input, args)
    if (!run.ok) return run
    let page: {
      data?: { repository?: { pullRequest?: { reviewThreads?: unknown } } } | null
      errors?: Array<{ message?: unknown }>
    }
    try {
      page = JSON.parse(run.stdout)
    } catch (err) {
      return { ok: false, error: `gh api graphql returned unparseable JSON: ${String(err)}` }
    }
    if (page.errors && page.errors.length > 0) {
      return {
        ok: false,
        error: `gh api graphql: ${page.errors.map((e) => str(e.message)).join('; ')}`,
      }
    }
    const connection = page.data?.repository?.pullRequest?.reviewThreads as
      | { pageInfo?: { hasNextPage?: unknown; endCursor?: unknown }; nodes?: unknown }
      | undefined
    if (!connection || !Array.isArray(connection.nodes)) {
      return { ok: false, error: 'gh api graphql returned no reviewThreads for the PR' }
    }
    threads.push(...connection.nodes.flatMap((node) => parseThread(node) ?? []))
    after =
      connection.pageInfo?.hasNextPage === true ? str(connection.pageInfo.endCursor) || null : null
  } while (after)
  return { ok: true, threads }
}

/** `https://github.com/<owner>/<repo>/pull/<n>` to owner and repo. */
function ownerRepo(prUrl: string): { owner: string; repo: string } | null {
  const m = prUrl.match(/^https?:\/\/[^/]+\/([^/]+)\/([^/]+)\/pull\/\d+/)
  return m?.[1] && m[2] ? { owner: m[1], repo: m[2] } : null
}

export async function fetchPrActivity(input: FetchPrActivityInput): Promise<FetchPrActivityResult> {
  const target = ownerRepo(input.prUrl)
  if (!target) return { ok: false, error: `cannot read owner and repo from PR url ${input.prUrl}` }

  const view = await runGh(input, [
    'pr',
    'view',
    String(input.prNumber),
    '--json',
    ACTIVITY_VIEW_FIELDS,
  ])
  if (!view.ok) return view
  let viewJson: Record<string, unknown>
  try {
    viewJson = JSON.parse(view.stdout)
  } catch (err) {
    return { ok: false, error: `gh pr view returned unparseable JSON: ${String(err)}` }
  }

  const threads = await fetchThreads(input, target.owner, target.repo)
  if (!threads.ok) return threads

  const activity: PrActivity = {
    checks: parseChecks(viewJson.statusCheckRollup),
    threads: threads.threads,
    comments: parseComments(viewJson),
  }
  await writeFile(join(input.runDir, 'pr-activity.json'), `${JSON.stringify(activity, null, 2)}\n`)
  return { ok: true, activity }
}
