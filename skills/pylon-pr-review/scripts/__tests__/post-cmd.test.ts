import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { formatPostBody, parseRepoFromUrl, runPost } from '../post-cmd.ts'

let runDir: string

beforeEach(async () => {
  runDir = await mkdtemp(join(tmpdir(), 'prskill-post-'))
})

afterEach(async () => {
  await rm(runDir, { recursive: true, force: true })
})

const findingA = {
  id: 'sec-1',
  file: 'apps/server/.env',
  line: 1,
  severity: 'blocker',
  risk: { impact: 'critical', likelihood: 'likely', confidence: 'high', action: 'must-fix' },
  title: 'Hardcoded secret',
  description: 'A .env file with a production-shaped secret is committed.',
  suggestion: { body: 'DB_CONNECTION_SECRET=replace-me', startLine: 1, endLine: 1 },
  domain: 'security',
}

const findingB = {
  id: 'bug-1',
  file: 'src/x.ts',
  line: null,
  severity: 'high',
  risk: { impact: 'high', likelihood: 'likely', confidence: 'high', action: 'must-fix' },
  title: 'Unanchored finding',
  description: 'No specific line; goes to the top-level PR comment.',
  domain: 'bugs',
}

async function seedRunDir(): Promise<void> {
  await writeFile(
    join(runDir, 'pr.json'),
    JSON.stringify({
      number: 42,
      headRefOid: 'deadbeef00112233',
      url: 'https://github.com/iceinvein/pylon/pull/42',
    }),
  )
  await writeFile(join(runDir, 'findings.final.json'), JSON.stringify([findingA, findingB]))
}

test('parseRepoFromUrl extracts owner/repo from a github PR url', () => {
  expect(parseRepoFromUrl('https://github.com/iceinvein/pylon/pull/42')).toBe('iceinvein/pylon')
  expect(parseRepoFromUrl('https://github.com/Org/the-repo/pull/1')).toBe('Org/the-repo')
  expect(parseRepoFromUrl('https://gitlab.com/x/y/pull/1')).toBeNull()
  expect(parseRepoFromUrl('not a url')).toBeNull()
})

test('formatPostBody renders severity + title + description, and a suggestion block when present', () => {
  const body = formatPostBody({
    ...findingA,
    line: 12,
    suggestion: { body: 'fixed code', startLine: 12, endLine: 12 },
  } as never)
  expect(body).toContain('**BLOCKER**')
  expect(body).toContain('Hardcoded secret')
  expect(body).toContain('A .env file with')
  expect(body).toContain('```suggestion\nfixed code\n```')
})

test('formatPostBody omits the suggestion block when no suggestion is set', () => {
  const body = formatPostBody({ ...findingB } as never)
  expect(body).toContain('Unanchored finding')
  expect(body).not.toContain('```suggestion')
})

test('runPost rejects when pr.json is missing', async () => {
  const outcome = await runPost({ runDir, findingIds: ['anything'] })
  expect(outcome.ok).toBe(false)
  expect(outcome.error).toMatch(/Cannot read pr.json/)
})

test('runPost rejects when url cannot be parsed to repo', async () => {
  await writeFile(
    join(runDir, 'pr.json'),
    JSON.stringify({ number: 1, headRefOid: 'abc', url: 'not-a-github-url' }),
  )
  await writeFile(join(runDir, 'findings.final.json'), JSON.stringify([findingA]))
  const outcome = await runPost({ runDir, findingIds: ['sec-1'] })
  expect(outcome.ok).toBe(false)
  expect(outcome.error).toMatch(/Missing PR target/)
})

test('runPost dry-run records commands per id without spawning gh', async () => {
  await seedRunDir()
  const outcome = await runPost({ runDir, findingIds: ['sec-1', 'bug-1'], dryRun: true })
  expect(outcome.ok).toBe(true)
  expect(outcome.target).toEqual({ repo: 'iceinvein/pylon', number: 42 })
  expect(outcome.results).toHaveLength(2)
  // First (anchored) uses gh api with path/line/side; second (unanchored) uses gh pr comment.
  expect(outcome.results[0]?.command?.[0]).toBe('api')
  expect(outcome.results[0]?.command).toContain('path=apps/server/.env')
  expect(outcome.results[0]?.command).toContain('line=1')
  expect(outcome.results[1]?.command?.slice(0, 3)).toEqual(['pr', 'comment', '42'])
  // post-status.json persists posted state.
  const status = JSON.parse(await readFile(join(runDir, 'post-status.json'), 'utf8'))
  expect(status['sec-1']).toBe('posted')
  expect(status['bug-1']).toBe('posted')
})

test('runPost reports unknown-id for ids not present in findings.final.json', async () => {
  await seedRunDir()
  const outcome = await runPost({ runDir, findingIds: ['ghost'], dryRun: true })
  expect(outcome.ok).toBe(true)
  expect(outcome.results[0]).toEqual({ id: 'ghost', status: 'unknown-id' })
})

test('runPost skips ids already marked as posted', async () => {
  await seedRunDir()
  await writeFile(join(runDir, 'post-status.json'), JSON.stringify({ 'sec-1': 'posted' }))
  const outcome = await runPost({ runDir, findingIds: ['sec-1', 'bug-1'], dryRun: true })
  expect(outcome.results[0]?.status).toBe('already-posted')
  expect(outcome.results[1]?.status).toBe('posted')
})

test('runPost surfaces gh failure per finding (here: gh binary missing)', async () => {
  await seedRunDir()
  // Point ghBin at a path that does not exist. runGh treats ENOENT as exit 127.
  const outcome = await runPost({
    runDir,
    findingIds: ['sec-1'],
    ghBin: '/does/not/exist/gh-binary',
  })
  expect(outcome.ok).toBe(true) // overall request succeeds; per-id reflects gh's failure
  expect(outcome.results[0]?.status).toBe('failed')
  expect(typeof outcome.results[0]?.message).toBe('string')
  expect(outcome.results[0]?.message?.length).toBeGreaterThan(0)
  const status = JSON.parse(await readFile(join(runDir, 'post-status.json'), 'utf8'))
  expect(typeof status['sec-1']).toBe('object')
  expect((status['sec-1'] as { status: string }).status).toBe('failed')
})

test('runPost appends post stage events to log.jsonl', async () => {
  await seedRunDir()
  await runPost({ runDir, findingIds: ['sec-1', 'bug-1'], dryRun: true })
  const log = await readFile(join(runDir, 'log.jsonl'), 'utf8')
  expect(log).toContain('"stage":"post"')
  expect(log).toContain('"status":"start"')
  expect(log).toContain('"status":"dry-run"')
})
