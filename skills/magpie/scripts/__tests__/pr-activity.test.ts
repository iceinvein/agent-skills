import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fetchPrActivity } from '../pr-activity.ts'

const PR_URL = 'https://github.com/octocat/Hello-World/pull/7'

const VIEW = {
  statusCheckRollup: [
    {
      __typename: 'CheckRun',
      name: 'build',
      status: 'COMPLETED',
      conclusion: 'FAILURE',
      detailsUrl: 'https://ci.example/1',
    },
    {
      __typename: 'StatusContext',
      context: 'lint',
      state: 'SUCCESS',
      targetUrl: 'https://ci.example/2',
    },
    { __typename: 'CheckRun', name: 'e2e', status: 'IN_PROGRESS', conclusion: '', detailsUrl: '' },
  ],
  comments: [
    { author: { login: 'alice' }, body: 'Does this retry past three attempts?' },
    { author: { login: 'octocat' }, body: '<!-- magpie:summary -->\n**Magpie review**' },
  ],
  reviews: [
    { author: { login: 'bob' }, body: '', state: 'APPROVED' },
    { author: { login: 'carol' }, body: 'Please add a test for the timeout.', state: 'COMMENTED' },
  ],
}

function threadPage(nodes: unknown[], endCursor: string | null): unknown {
  return {
    data: {
      repository: {
        pullRequest: {
          reviewThreads: { pageInfo: { hasNextPage: endCursor !== null, endCursor }, nodes },
        },
      },
    },
  }
}

const THREAD_OPEN = {
  path: 'src/upload.ts',
  line: 42,
  originalLine: 40,
  isResolved: false,
  isOutdated: false,
  comments: {
    totalCount: 3,
    nodes: [{ author: { login: 'dave' }, body: 'This swallows the timeout error.' }],
  },
}

const THREAD_MAGPIE = {
  path: 'src/cache.ts',
  line: null,
  originalLine: 9,
  isResolved: true,
  isOutdated: true,
  comments: {
    totalCount: 1,
    nodes: [
      {
        author: { login: 'octocat' },
        body: '### High\nCache never evicts\n<!-- magpie:finding id=perf-1 hash=abc -->',
      },
    ],
  },
}

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'magpie-activity-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/**
 * A fake gh that answers the activity `pr view` from view.json and each
 * `api graphql` page from page-<cursor>.json (page-start.json with no cursor),
 * recording every invocation's arguments to calls.log.
 */
async function fakeGh(view: unknown, pages: Record<string, unknown>): Promise<string> {
  await writeFile(join(dir, 'view.json'), JSON.stringify(view))
  for (const [cursor, page] of Object.entries(pages)) {
    await writeFile(join(dir, `page-${cursor}.json`), JSON.stringify(page))
  }
  const script = join(dir, 'gh.sh')
  await writeFile(
    script,
    [
      '#!/usr/bin/env bash',
      // One line per call: the query argument spans several lines.
      `printf '%s\\n' "$(echo "$*" | tr '\\n' ' ')" >> "${dir}/calls.log"`,
      'if [[ "$1 $2" == "pr view" ]]; then',
      `  cat "${dir}/view.json"; exit 0`,
      'fi',
      'if [[ "$1 $2" == "api graphql" ]]; then',
      '  cursor=start',
      '  for arg in "$@"; do',
      '    case "$arg" in after=*) cursor=$(echo "$arg" | sed "s/^after=//") ;; esac',
      '  done',
      `  cat "${dir}/page-$cursor.json"; exit 0`,
      'fi',
      'echo "unsupported: $*" >&2; exit 1',
    ].join('\n'),
  )
  await Bun.spawn(['chmod', '+x', script]).exited
  return script
}

test('checks are normalised to name, conclusion and url, in-progress ones as their status', async () => {
  const gh = await fakeGh(VIEW, { start: threadPage([], null) })
  const result = await fetchPrActivity({ ghBin: gh, prNumber: 7, prUrl: PR_URL, runDir: dir })
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.activity.checks).toEqual([
    { name: 'build', conclusion: 'FAILURE', url: 'https://ci.example/1' },
    { name: 'lint', conclusion: 'SUCCESS', url: 'https://ci.example/2' },
    { name: 'e2e', conclusion: 'IN_PROGRESS', url: null },
  ])
})

test('top-level comments and non-empty review bodies are kept, magpie summary excluded', async () => {
  const gh = await fakeGh(VIEW, { start: threadPage([], null) })
  const result = await fetchPrActivity({ ghBin: gh, prNumber: 7, prUrl: PR_URL, runDir: dir })
  if (!result.ok) throw new Error(result.error)
  expect(result.activity.comments).toEqual([
    { author: 'alice', body: 'Does this retry past three attempts?', magpie: false },
    { author: 'carol', body: 'Please add a test for the timeout.', magpie: false },
  ])
})

test('review threads carry file, line, state, first comment and reply count, flagging magpie', async () => {
  const gh = await fakeGh(VIEW, { start: threadPage([THREAD_OPEN, THREAD_MAGPIE], null) })
  const result = await fetchPrActivity({ ghBin: gh, prNumber: 7, prUrl: PR_URL, runDir: dir })
  if (!result.ok) throw new Error(result.error)
  expect(result.activity.threads).toEqual([
    {
      file: 'src/upload.ts',
      line: 42,
      resolved: false,
      outdated: false,
      author: 'dave',
      body: 'This swallows the timeout error.',
      replies: 2,
      magpie: false,
    },
    {
      file: 'src/cache.ts',
      line: 9,
      resolved: true,
      outdated: true,
      author: 'octocat',
      body: '### High\nCache never evicts\n<!-- magpie:finding id=perf-1 hash=abc -->',
      replies: 0,
      magpie: true,
    },
  ])
})

test('every page of review threads is fetched', async () => {
  const second = { ...THREAD_OPEN, path: 'src/second.ts' }
  const gh = await fakeGh(VIEW, {
    start: threadPage([THREAD_OPEN], 'CURSOR1'),
    CURSOR1: threadPage([second], null),
  })
  const result = await fetchPrActivity({ ghBin: gh, prNumber: 7, prUrl: PR_URL, runDir: dir })
  if (!result.ok) throw new Error(result.error)
  expect(result.activity.threads.map((t) => t.file)).toEqual(['src/upload.ts', 'src/second.ts'])
})

test('the activity is written to pr-activity.json in the run dir', async () => {
  const gh = await fakeGh(VIEW, { start: threadPage([THREAD_OPEN], null) })
  const result = await fetchPrActivity({ ghBin: gh, prNumber: 7, prUrl: PR_URL, runDir: dir })
  if (!result.ok) throw new Error(result.error)
  const written = JSON.parse(await readFile(join(dir, 'pr-activity.json'), 'utf8'))
  expect(written.threads[0].file).toBe('src/upload.ts')
  expect(written.checks[0].name).toBe('build')
})

test('the thread query targets the owner, repo and number from the PR url', async () => {
  const gh = await fakeGh(VIEW, { start: threadPage([], null) })
  await fetchPrActivity({ ghBin: gh, prNumber: 7, prUrl: PR_URL, runDir: dir })
  const calls = await readFile(join(dir, 'calls.log'), 'utf8')
  const graphql = calls.split('\n').find((l) => l.startsWith('api graphql')) ?? ''
  expect(graphql).toContain('owner=octocat')
  expect(graphql).toContain('repo=Hello-World')
  expect(graphql).toContain('number=7')
})

test('a failing gh call fails the fetch with its stderr', async () => {
  const script = join(dir, 'gh.sh')
  await writeFile(script, '#!/usr/bin/env bash\necho "HTTP 403: rate limited" >&2\nexit 1\n')
  await Bun.spawn(['chmod', '+x', script]).exited
  const result = await fetchPrActivity({ ghBin: script, prNumber: 7, prUrl: PR_URL, runDir: dir })
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.error).toContain('HTTP 403: rate limited')
})

test('a graphql response with errors fails the fetch, naming them', async () => {
  const gh = await fakeGh(VIEW, {
    start: { data: null, errors: [{ message: 'Could not resolve to a Repository' }] },
  })
  const result = await fetchPrActivity({ ghBin: gh, prNumber: 7, prUrl: PR_URL, runDir: dir })
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.error).toContain('Could not resolve to a Repository')
})

test('a PR url that names no owner and repo fails the fetch', async () => {
  const gh = await fakeGh(VIEW, { start: threadPage([], null) })
  const result = await fetchPrActivity({
    ghBin: gh,
    prNumber: 7,
    prUrl: 'not a url',
    runDir: dir,
  })
  expect(result.ok).toBe(false)
})

test('a deleted user reads as ghost, the name GitHub shows for one', async () => {
  const view = {
    statusCheckRollup: [],
    comments: [{ author: null, body: 'Old question' }],
    reviews: [],
  }
  const gh = await fakeGh(view, { start: threadPage([], null) })
  const result = await fetchPrActivity({ ghBin: gh, prNumber: 7, prUrl: PR_URL, runDir: dir })
  if (!result.ok) throw new Error(result.error)
  expect(result.activity.comments).toEqual([
    { author: 'ghost', body: 'Old question', magpie: false },
  ])
})

test('a thread whose first comment was deleted is left out', async () => {
  const emptied = { ...THREAD_OPEN, comments: { totalCount: 0, nodes: [] } }
  const gh = await fakeGh(VIEW, { start: threadPage([emptied, THREAD_MAGPIE], null) })
  const result = await fetchPrActivity({ ghBin: gh, prNumber: 7, prUrl: PR_URL, runDir: dir })
  if (!result.ok) throw new Error(result.error)
  expect(result.activity.threads.map((t) => t.file)).toEqual(['src/cache.ts'])
})

test('a review body holding several magpie findings is split into one comment each', async () => {
  const body = [
    'Overall fine.',
    '**First finding**\n<!-- magpie:finding id=bugs-1 hash=a -->',
    '**Second finding**\n<!-- magpie:finding id=bugs-2 hash=b -->',
  ].join('\n\n---\n\n')
  const view = {
    statusCheckRollup: [],
    comments: [],
    reviews: [{ author: { login: 'octocat' }, body, state: 'COMMENTED' }],
  }
  const gh = await fakeGh(view, { start: threadPage([], null) })
  const result = await fetchPrActivity({ ghBin: gh, prNumber: 7, prUrl: PR_URL, runDir: dir })
  if (!result.ok) throw new Error(result.error)
  expect(result.activity.comments).toEqual([
    { author: 'octocat', body: 'Overall fine.', magpie: false },
    {
      author: 'octocat',
      body: '**First finding**\n<!-- magpie:finding id=bugs-1 hash=a -->',
      magpie: true,
    },
    {
      author: 'octocat',
      body: '**Second finding**\n<!-- magpie:finding id=bugs-2 hash=b -->',
      magpie: true,
    },
  ])
})
