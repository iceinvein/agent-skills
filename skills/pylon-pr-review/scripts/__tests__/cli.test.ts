import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CLI = new URL('../../bin/pr-review.ts', import.meta.url).pathname

test('unknown subcommand exits non-zero with usage', async () => {
  const proc = Bun.spawn(['bun', CLI, 'wat'], { stderr: 'pipe', stdout: 'pipe' })
  const exit = await proc.exited
  const stderr = await new Response(proc.stderr).text()
  expect(exit).not.toBe(0)
  expect(stderr).toContain('Unknown subcommand: wat')
  expect(stderr).toContain('Usage: pr-review <subcommand>')
})

test('no subcommand exits non-zero with usage', async () => {
  const proc = Bun.spawn(['bun', CLI], { stderr: 'pipe' })
  const exit = await proc.exited
  const stderr = await new Response(proc.stderr).text()
  expect(exit).not.toBe(0)
  expect(stderr).toContain('Usage: pr-review <subcommand>')
})

test('--help prints usage and exits 0', async () => {
  const proc = Bun.spawn(['bun', CLI, '--help'], { stdout: 'pipe' })
  const exit = await proc.exited
  const stdout = await new Response(proc.stdout).text()
  expect(exit).toBe(0)
  expect(stdout).toContain('Usage: pr-review <subcommand>')
  // Both new subcommands surfaced in --help
  expect(stdout).toContain('open ')
  expect(stdout).toMatch(/serve <run-dir-or-id>/)
})

test('open --dry-run resolves latest run and prints opener + path', async () => {
  const home = await mkdtemp(join(tmpdir(), 'prskill-cli-open-'))
  try {
    const runPath = join(home, 'pr-1-1000')
    await mkdir(join(runPath, 'screen'), { recursive: true })
    await writeFile(join(runPath, 'screen', 'findings.html'), '<html></html>')

    const proc = Bun.spawn(['bun', CLI, 'open', '--dry-run'], {
      env: { ...process.env, PYLON_REVIEW_HOME: home, PR_REVIEW_OPENER: 'fakeopen' },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const stdout = await new Response(proc.stdout).text()
    const exit = await proc.exited
    expect(exit).toBe(0)
    expect(stdout).toContain('fakeopen')
    expect(stdout).toContain('pr-1-1000/screen/findings.html')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
