import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fetchPr } from '../gh.ts'

const FAKE_GH = new URL('../../fixtures/fake-gh.sh', import.meta.url).pathname
const FAKE_GH_NODIFF = new URL('../../fixtures/fake-gh-nodiff.sh', import.meta.url).pathname

let runDir: string
let repo = ''

async function git(cwd: string, ...args: string[]): Promise<string> {
  const proc = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  const stdout = await new Response(proc.stdout).text()
  const exit = await proc.exited
  if (exit !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`git ${args.join(' ')} exit ${exit}: ${stderr}`)
  }
  return stdout.trim()
}

async function makeRepo(): Promise<string> {
  repo = await mkdtemp(join(tmpdir(), 'magpie-gh-repo-'))
  await git(repo, 'init', '-b', 'main')
  await git(repo, 'config', 'user.email', 'test@example.com')
  await git(repo, 'config', 'user.name', 'Test')
  await writeFile(join(repo, 'a.ts'), 'export const x = 1\n')
  await git(repo, 'add', '.')
  await git(repo, 'commit', '-m', 'base')
  await git(repo, 'checkout', '-b', 'feature-x')
  await writeFile(join(repo, 'a.ts'), 'export const x = 2\n')
  await git(repo, 'commit', '-am', 'change x')
  const head = await git(repo, 'rev-parse', 'HEAD')
  await git(repo, 'checkout', 'main')
  return head
}

beforeEach(async () => {
  runDir = await mkdtemp(join(tmpdir(), 'magpie-gh-'))
})

afterEach(async () => {
  await rm(runDir, { recursive: true, force: true })
  if (repo) {
    await rm(repo, { recursive: true, force: true })
    repo = ''
  }
})

test('fetchPr writes pr.json and diff.patch', async () => {
  const result = await fetchPr({ ghBin: FAKE_GH, prNumber: 1234, runDir })
  expect(result.ok).toBe(true)
  const prJson = JSON.parse(await readFile(join(runDir, 'pr.json'), 'utf8'))
  expect(prJson.number).toBe(1234)
  expect(prJson.headRefName).toBe('feature-x')
  const diff = await readFile(join(runDir, 'diff.patch'), 'utf8')
  expect(diff).toContain('export const x = 2')
})

test('fetchPr includes files in pr.json', async () => {
  const result = await fetchPr({ ghBin: FAKE_GH, prNumber: 1234, runDir })
  expect(result.ok).toBe(true)
  const pr = JSON.parse(await readFile(join(runDir, 'pr.json'), 'utf8'))
  expect(Array.isArray(pr.files)).toBe(true)
  expect(pr.files[0]).toMatchObject({ path: 'src/a.ts', additions: 1, deletions: 0 })
})

test('fetchPr returns ok=false when gh exits non-zero', async () => {
  const result = await fetchPr({
    ghBin: '/usr/bin/false',
    prNumber: 1234,
    runDir,
  })
  expect(result.ok).toBe(false)
  if (!result.ok) {
    expect(result.error).toBeDefined()
  }
})

test('PR_VIEW_FIELDS requests commit messages and linked issues', async () => {
  const { PR_VIEW_FIELDS } = await import('../gh.ts')
  const fields = PR_VIEW_FIELDS.split(',')
  expect(fields).toContain('commits')
  expect(fields).toContain('closingIssuesReferences')
  // The pre-existing fields must survive the edit.
  for (const field of ['number', 'title', 'body', 'url', 'files', 'headRefOid']) {
    expect(fields).toContain(field)
  }
})

test('fetchPr carries commits and linked issues into pr.json', async () => {
  const result = await fetchPr({ ghBin: FAKE_GH, prNumber: 1234, runDir })
  expect(result.ok).toBe(true)
  const pr = JSON.parse(await readFile(join(runDir, 'pr.json'), 'utf8'))
  expect(Array.isArray(pr.commits)).toBe(true)
  expect(pr.commits[0].messageHeadline).toBe('Add retry handling to the upload path')
  expect(Array.isArray(pr.closingIssuesReferences)).toBe(true)
  expect(pr.closingIssuesReferences[0]).toMatchObject({ number: 42 })
})

test('fetchPr falls back to local git when gh pr diff fails', async () => {
  const head = await makeRepo()
  const result = await fetchPr({
    ghBin: FAKE_GH_NODIFF,
    gitBin: 'git',
    prNumber: 7,
    runDir,
    cwd: repo,
    env: { MAGPIE_FAKE_HEAD_OID: head },
  })
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.source).toBe('git')
  expect(result.mergeBase).toMatch(/^[0-9a-f]{40}$/)
  const diff = await readFile(join(runDir, 'diff.patch'), 'utf8')
  expect(diff).toContain('export const x = 2')
})

test('fetchPr falls back when gh returns an empty diff for a non-empty PR', async () => {
  const head = await makeRepo()
  const result = await fetchPr({
    ghBin: FAKE_GH_NODIFF,
    gitBin: 'git',
    prNumber: 7,
    runDir,
    cwd: repo,
    env: { MAGPIE_FAKE_HEAD_OID: head, MAGPIE_FAKE_DIFF_MODE: 'empty' },
  })
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.source).toBe('git')
  const diff = await readFile(join(runDir, 'diff.patch'), 'utf8')
  expect(diff).toContain('export const x = 2')
})

test('fetchPr reports source gh when gh succeeds', async () => {
  const result = await fetchPr({ ghBin: FAKE_GH, prNumber: 1234, runDir })
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.source).toBe('gh')
  expect(result.mergeBase).toBeUndefined()
})

test('fetchPr fails when gh refuses and the head SHA is not local', async () => {
  await makeRepo()
  const result = await fetchPr({
    ghBin: FAKE_GH_NODIFF,
    gitBin: 'git',
    prNumber: 7,
    runDir,
    cwd: repo,
    // No MAGPIE_FAKE_HEAD_OID, so pr.json carries a SHA this repo has never seen.
  })
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.error).toContain('cannot resolve PR head')
  expect(result.error).toContain('406')
})
