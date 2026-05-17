import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CLI = new URL('../../bin/magpie.ts', import.meta.url).pathname
const BIN_WRAPPER = new URL('../../bin/magpie', import.meta.url).pathname

test('unknown subcommand exits non-zero with usage', async () => {
  const proc = Bun.spawn(['bun', CLI, 'wat'], { stderr: 'pipe', stdout: 'pipe' })
  const exit = await proc.exited
  const stderr = await new Response(proc.stderr).text()
  expect(exit).not.toBe(0)
  expect(stderr).toContain('Unknown subcommand: wat')
  expect(stderr).toContain('Usage: magpie <subcommand>')
})

test('no subcommand exits non-zero with usage', async () => {
  const proc = Bun.spawn(['bun', CLI], { stderr: 'pipe' })
  const exit = await proc.exited
  const stderr = await new Response(proc.stderr).text()
  expect(exit).not.toBe(0)
  expect(stderr).toContain('Usage: magpie <subcommand>')
})

test('--version prints "magpie <semver>" and exits 0', async () => {
  const proc = Bun.spawn(['bun', CLI, '--version'], { stdout: 'pipe' })
  const exit = await proc.exited
  const stdout = await new Response(proc.stdout).text()
  expect(exit).toBe(0)
  expect(stdout.trim()).toMatch(/^magpie \d+\.\d+\.\d+$/)
})

test('-V is an alias for --version', async () => {
  const proc = Bun.spawn(['bun', CLI, '-V'], { stdout: 'pipe' })
  const exit = await proc.exited
  const stdout = await new Response(proc.stdout).text()
  expect(exit).toBe(0)
  expect(stdout.trim()).toMatch(/^magpie \d+\.\d+\.\d+$/)
})

test('--help prints usage and exits 0', async () => {
  const proc = Bun.spawn(['bun', CLI, '--help'], { stdout: 'pipe' })
  const exit = await proc.exited
  const stdout = await new Response(proc.stdout).text()
  expect(exit).toBe(0)
  expect(stdout).toContain('Usage: magpie <subcommand>')
  // Both new subcommands surfaced in --help
  expect(stdout).toContain('open ')
  expect(stdout).toMatch(/serve <run-dir-or-id>/)
})

test('bin/magpie wrapper resolves --help when invoked via a symlink (PATH install)', async () => {
  // Reproduces the original install.sh bug where `dirname "$0"` resolved to the
  // symlink's directory, not the script's actual directory, breaking PATH installs.
  const linkDir = await mkdtemp(join(tmpdir(), 'magpie-link-'))
  const link = join(linkDir, 'magpie')
  try {
    await symlink(BIN_WRAPPER, link)
    const proc = Bun.spawn([link, '--help'], { stdout: 'pipe', stderr: 'pipe' })
    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const exit = await proc.exited
    expect(exit).toBe(0)
    expect(stdout).toContain('Usage: magpie <subcommand>')
    expect(stderr).not.toContain('Module not found')
  } finally {
    await rm(linkDir, { recursive: true, force: true })
  }
})

test('open --dry-run resolves latest run and prints opener + path', async () => {
  const home = await mkdtemp(join(tmpdir(), 'magpie-cli-open-'))
  try {
    const runPath = join(home, 'pr-1-1000')
    await mkdir(join(runPath, 'screen'), { recursive: true })
    await writeFile(join(runPath, 'screen', 'findings.html'), '<html></html>')

    const proc = Bun.spawn(['bun', CLI, 'open', '--dry-run'], {
      env: { ...process.env, MAGPIE_HOME: home, MAGPIE_OPENER: 'fakeopen' },
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

test('post --dry-run dispatches to runPost and prints the outcome JSON', async () => {
  const runDir = await mkdtemp(join(tmpdir(), 'magpie-cli-post-'))
  try {
    await writeFile(
      join(runDir, 'pr.json'),
      JSON.stringify({
        number: 7,
        headRefOid: 'deadbeefcafef00d',
        url: 'https://github.com/iceinvein/pylon/pull/7',
      }),
    )
    await writeFile(
      join(runDir, 'findings.final.json'),
      JSON.stringify([
        {
          id: 'sec-1',
          file: 'src/a.ts',
          line: 12,
          severity: 'high',
          risk: { impact: 'high', likelihood: 'likely', confidence: 'high', action: 'must-fix' },
          title: 'oops',
          description: 'Observation: a real defect.\n\nWhy it matters: it hurts.',
          domain: 'security',
        },
      ]),
    )
    const proc = Bun.spawn(
      ['bun', CLI, 'post', runDir, '--ids', 'sec-1', '--dry-run', '--include-summary', 'never'],
      { stdout: 'pipe', stderr: 'pipe' },
    )
    const stdout = await new Response(proc.stdout).text()
    const exit = await proc.exited
    expect(exit).toBe(0)
    const outcome = JSON.parse(stdout.trim())
    expect(outcome.ok).toBe(true)
    expect(outcome.target).toEqual({ repo: 'iceinvein/pylon', number: 7 })
    expect(outcome.results[0].status).toBe('posted')
    expect(outcome.results[0].command?.[0]).toBe('api')
  } finally {
    await rm(runDir, { recursive: true, force: true })
  }
})

test('post rejects invalid --include-summary value', async () => {
  const proc = Bun.spawn(
    ['bun', CLI, 'post', '/tmp/anything', '--ids', 'x', '--include-summary', 'bogus'],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  const stderr = await new Response(proc.stderr).text()
  const exit = await proc.exited
  expect(exit).toBe(2)
  expect(stderr).toContain('post: invalid --include-summary bogus')
})

test('post rejects missing --ids', async () => {
  const proc = Bun.spawn(['bun', CLI, 'post', '/tmp/anything'], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const stderr = await new Response(proc.stderr).text()
  const exit = await proc.exited
  expect(exit).toBe(2)
  expect(stderr).toContain('post: missing --ids')
})
