import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { runCleanup } from '../cleanup-cmd.ts'
import { runDedupe } from '../dedupe-cmd.ts'
import { runRender } from '../render-cmd.ts'
import { runSetup } from '../setup-cmd.ts'

const FAKE_GH = new URL('../../fixtures/fake-gh.sh', import.meta.url).pathname

let repo: string
let runDir: string

async function sh(cwd: string, ...cmd: string[]): Promise<void> {
  const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' })
  const exit = await proc.exited
  if (exit !== 0) throw new Error(`${cmd.join(' ')} exit ${exit}`)
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'prskill-e2e-repo-'))
  runDir = await mkdtemp(join(tmpdir(), 'prskill-e2e-run-'))
  await rm(runDir, { recursive: true, force: true })
  await sh(repo, 'git', 'init', '-q', '-b', 'main')
  await sh(repo, 'git', 'config', 'user.email', 't@t.t')
  await sh(repo, 'git', 'config', 'user.name', 't')
  await sh(repo, 'git', 'config', 'commit.gpgsign', 'false')
  await sh(repo, 'git', 'config', 'tag.gpgsign', 'false')
  await writeFile(join(repo, 'a.txt'), 'a\n')
  await sh(repo, 'git', 'add', '.')
  await sh(repo, 'git', 'commit', '-q', '-m', 'init')
  await sh(repo, 'git', 'branch', 'feature-x')
})

afterEach(async () => {
  await rm(repo, { recursive: true, force: true })
  // run-dir is renamed to .archived-* by cleanup; remove any leftover.
  await rm(runDir, { recursive: true, force: true }).catch(() => {})
})

test('setup -> dedupe -> render(progress) -> render(findings) -> cleanup composes', async () => {
  const setupExit = await runSetup({
    runDir,
    prNumber: 1234,
    repoPath: repo,
    deps: { bun: 'bun', gh: FAKE_GH, codex: 'echo', git: 'git' },
  })
  expect(setupExit).toBe(0)

  await writeFile(
    join(runDir, 'findings', 'bugs.json'),
    JSON.stringify([
      {
        id: 'a',
        file: 'a.txt',
        line: 1,
        severity: 'high',
        risk: { impact: 'high', likelihood: 'likely', confidence: 'high', action: 'must-fix' },
        title: 'first bug',
        description: 'd',
        domain: 'bugs',
      },
    ]),
  )

  expect(await runDedupe(runDir)).toBe(0)
  await writeFile(
    join(runDir, 'findings.final.json'),
    await Bun.file(join(runDir, 'findings.deduped.json')).text(),
  )

  expect(await runRender(runDir, 'progress')).toBe(0)
  expect(await runRender(runDir, 'findings')).toBe(0)

  const screen = await readdir(join(runDir, 'screen'))
  expect(screen).toContain('progress.html')
  expect(screen).toContain('findings.html')

  expect(await runCleanup({ runDir, repoPath: repo, gitBin: 'git' })).toBe(0)
  const parent = dirname(runDir)
  const entries = await readdir(parent)
  expect(entries.find((e) => e.startsWith(`${basename(runDir)}.archived-`))).toBeDefined()
})
