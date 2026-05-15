import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { runCleanup } from '../cleanup-cmd.ts'

let repo: string
let runDir: string

async function sh(cwd: string, ...cmd: string[]): Promise<void> {
  const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' })
  const exit = await proc.exited
  if (exit !== 0) throw new Error(`${cmd.join(' ')} exit ${exit}`)
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'prskill-cleanup-repo-'))
  runDir = await mkdtemp(join(tmpdir(), 'prskill-cleanup-run-'))
  await sh(repo, 'git', 'init', '-q', '-b', 'main')
  await sh(repo, 'git', 'config', 'user.email', 't@t.t')
  await sh(repo, 'git', 'config', 'user.name', 't')
  await sh(repo, 'git', 'config', 'commit.gpgsign', 'false')
  await sh(repo, 'git', 'config', 'tag.gpgsign', 'false')
  await writeFile(join(repo, 'a.txt'), 'a\n')
  await sh(repo, 'git', 'add', '.')
  await sh(repo, 'git', 'commit', '-q', '-m', 'init')
  await sh(repo, 'git', 'worktree', 'add', '--detach', join(runDir, 'worktree'), 'HEAD')
  await mkdir(join(runDir, 'state'), { recursive: true })
})

afterEach(async () => {
  await rm(repo, { recursive: true, force: true })
  await rm(runDir, { recursive: true, force: true }).catch(() => {})
})

test('cleanup removes worktree and archives run dir', async () => {
  const exit = await runCleanup({ runDir, repoPath: repo, gitBin: 'git' })
  expect(exit).toBe(0)
  const original = await Bun.file(join(runDir, 'worktree', 'a.txt')).exists()
  expect(original).toBe(false)
  const parent = dirname(runDir)
  const entries = await readdir(parent)
  const archived = entries.find((e) => e.startsWith(`${basename(runDir)}.archived-`))
  expect(archived).toBeDefined()
})
