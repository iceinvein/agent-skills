import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runSetup } from '../setup-cmd.ts'

const FAKE_GH = new URL('../../fixtures/fake-gh.sh', import.meta.url).pathname
const FALSE_BIN = '/usr/bin/false'

let repo: string
let runDir: string

async function sh(cwd: string, ...cmd: string[]): Promise<void> {
  const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' })
  const exit = await proc.exited
  if (exit !== 0) {
    const err = await new Response(proc.stderr).text()
    throw new Error(`${cmd.join(' ')} exit ${exit}: ${err}`)
  }
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'prskill-setup-repo-'))
  runDir = await mkdtemp(join(tmpdir(), 'prskill-setup-run-'))
  await sh(repo, 'git', 'init', '-q', '-b', 'main')
  await sh(repo, 'git', 'config', 'user.email', 't@t.t')
  await sh(repo, 'git', 'config', 'user.name', 't')
  await sh(repo, 'git', 'config', 'commit.gpgsign', 'false')
  await sh(repo, 'git', 'config', 'tag.gpgsign', 'false')
  await writeFile(join(repo, 'a.txt'), 'one\n')
  await sh(repo, 'git', 'add', '.')
  await sh(repo, 'git', 'commit', '-q', '-m', 'init')
  await sh(repo, 'git', 'branch', 'feature-x')
})

afterEach(async () => {
  await rm(repo, { recursive: true, force: true })
  await rm(runDir, { recursive: true, force: true })
})

test('runSetup completes happy path: writes pr.json, diff.patch, worktree', async () => {
  const exit = await runSetup({
    runDir,
    prNumber: 1234,
    repoPath: repo,
    deps: { bun: 'bun', gh: FAKE_GH, codex: 'echo', git: 'git' },
  })
  expect(exit).toBe(0)
  const contents = await readdir(runDir)
  expect(contents).toContain('pr.json')
  expect(contents).toContain('diff.patch')
  expect(contents).toContain('worktree')
})

test('runSetup with missing dep returns non-zero and cleans up', async () => {
  const exit = await runSetup({
    runDir,
    prNumber: 1234,
    repoPath: repo,
    deps: { bun: 'bun', gh: 'definitely-not-a-thing', codex: 'echo', git: 'git' },
  })
  expect(exit).not.toBe(0)
  const contents = await readdir(runDir).catch(() => [])
  expect(contents.filter((c) => c !== 'log.jsonl')).toHaveLength(0)
})

test('runSetup with failing gh removes any partial state', async () => {
  const exit = await runSetup({
    runDir,
    prNumber: 1234,
    repoPath: repo,
    deps: { bun: 'bun', gh: FALSE_BIN, codex: 'echo', git: 'git' },
  })
  expect(exit).not.toBe(0)
  const contents = await readdir(runDir).catch(() => [])
  expect(contents).not.toContain('worktree')
  expect(contents).not.toContain('pr.json')
})
