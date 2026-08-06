import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
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

test('preview surfaces its own --help block with the stage preset list', async () => {
  const proc = Bun.spawn(['bun', CLI, 'preview', '--help'], { stdout: 'pipe' })
  const stdout = await new Response(proc.stdout).text()
  const exit = await proc.exited
  expect(exit).toBe(0)
  expect(stdout).toContain('Usage: magpie preview')
  expect(stdout).toContain('--stage')
  // Sanity-check that the preset list mentions both endpoints of the pipeline.
  expect(stdout).toContain('fresh')
  expect(stdout).toContain('post-done')
})

test('preview --list-stages prints every known preset, one per line', async () => {
  const proc = Bun.spawn(['bun', CLI, 'preview', '--list-stages'], { stdout: 'pipe' })
  const stdout = await new Response(proc.stdout).text()
  const exit = await proc.exited
  expect(exit).toBe(0)
  const presets = stdout.trim().split('\n')
  expect(presets).toContain('fresh')
  expect(presets).toContain('specialists-running')
  expect(presets).toContain('peer-review-error')
  expect(presets).toContain('report-done')
  expect(presets).toContain('post-done')
})

test('preview --dry-run --no-open writes nothing and prints the planned paths', async () => {
  const out = await mkdtemp(join(tmpdir(), 'magpie-cli-preview-'))
  try {
    // mkdtemp creates the directory; remove it so we can confirm the dry-run
    // truly writes nothing on its own. The handler should still report it
    // would have written here.
    await rm(out, { recursive: true, force: true })
    const proc = Bun.spawn(
      ['bun', CLI, 'preview', '--dry-run', '--no-open', '--out', out, '--stage', 'critic-done'],
      { stdout: 'pipe', stderr: 'pipe' },
    )
    const stdout = await new Response(proc.stdout).text()
    const exit = await proc.exited
    expect(exit).toBe(0)
    const result = JSON.parse(stdout.trim())
    expect(result.dryRun).toBe(true)
    expect(result.outDir).toBe(out)
    expect(result.findingsHtml).toBe(join(out, 'findings.html'))
    expect(result.progressHtml).toBe(join(out, 'progress.html'))
    // Dry run must not create the directory or any files inside it.
    const findingsFile = Bun.file(join(out, 'findings.html'))
    expect(await findingsFile.exists()).toBe(false)
  } finally {
    await rm(out, { recursive: true, force: true })
  }
})

test('preview --no-open renders the requested page to disk and returns its path', async () => {
  const out = await mkdtemp(join(tmpdir(), 'magpie-cli-preview-render-'))
  try {
    const proc = Bun.spawn(
      [
        'bun',
        CLI,
        'preview',
        '--no-open',
        '--page',
        'progress',
        '--stage',
        'specialists-running',
        '--out',
        out,
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    )
    const stdout = await new Response(proc.stdout).text()
    const exit = await proc.exited
    expect(exit).toBe(0)
    const result = JSON.parse(stdout.trim())
    expect(result.progressHtml).toBe(join(out, 'progress.html'))
    expect(result.findingsHtml).toBeUndefined()
    const html = await Bun.file(join(out, 'progress.html')).text()
    // The preset has setup + context done (2/7 segments filled) and
    // specialists running.
    expect(html).toContain('--done-count: 2')
    expect(html).toContain('class="step running"')
    expect(html).toContain('data-stage="specialists"')
  } finally {
    await rm(out, { recursive: true, force: true })
  }
})

test('preview rejects an unknown --stage with exit 2 and a hint', async () => {
  const proc = Bun.spawn(['bun', CLI, 'preview', '--no-open', '--stage', 'bogus'], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const stderr = await new Response(proc.stderr).text()
  const exit = await proc.exited
  expect(exit).toBe(2)
  expect(stderr).toContain('preview: invalid --stage bogus')
  expect(stderr).toContain('--list-stages')
})

test('preview rejects an unknown --page with exit 2', async () => {
  const proc = Bun.spawn(['bun', CLI, 'preview', '--no-open', '--page', 'sidebar'], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const stderr = await new Response(proc.stderr).text()
  const exit = await proc.exited
  expect(exit).toBe(2)
  expect(stderr).toContain('preview: invalid --page sidebar')
})

test('top-level --help surfaces the preview subcommand', async () => {
  const proc = Bun.spawn(['bun', CLI, '--help'], { stdout: 'pipe' })
  const stdout = await new Response(proc.stdout).text()
  const exit = await proc.exited
  expect(exit).toBe(0)
  expect(stdout).toContain('preview')
  expect(stdout).toContain('--help-preview')
})

test('shard rejects missing <run-dir>', async () => {
  const proc = Bun.spawn(['bun', CLI, 'shard'], { stdout: 'pipe', stderr: 'pipe' })
  const stderr = await new Response(proc.stderr).text()
  const exit = await proc.exited
  expect(exit).toBe(2)
  expect(stderr).toContain('shard: missing <run-dir>')
})

test('shard rejects a zero, negative, or non-numeric --budget, naming the flag and value', async () => {
  for (const bad of ['0', '-5', 'abc']) {
    const proc = Bun.spawn(['bun', CLI, 'shard', '/tmp/does-not-matter', '--budget', bad], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const stderr = await new Response(proc.stderr).text()
    const exit = await proc.exited
    expect(exit).toBe(2)
    expect(stderr).toContain(`shard: invalid --budget ${bad}`)
  }
})

test('shard rejects an invalid --max-files, naming the flag and value', async () => {
  const proc = Bun.spawn(['bun', CLI, 'shard', '/tmp/does-not-matter', '--max-files', '-1'], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const stderr = await new Response(proc.stderr).text()
  const exit = await proc.exited
  expect(exit).toBe(2)
  expect(stderr).toContain('shard: invalid --max-files -1')
})

test('shard with a custom --budget and --max-files reaches shardDiff with those values', async () => {
  const runDir = await mkdtemp(join(tmpdir(), 'magpie-cli-shard-'))
  try {
    // Two files under the same two-segment directory group ('src'), each with
    // its own diff --git block, so a --max-files 1 cap forces the group apart
    // into two shards regardless of --budget: proof the flags actually reach
    // shardDiff rather than the defaults (budget 6000, max-files 80) taking
    // over silently.
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      'index 0000000..1111111 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1 +1 @@',
      '-x',
      '+y',
      'diff --git a/src/b.ts b/src/b.ts',
      'index 0000000..1111111 100644',
      '--- a/src/b.ts',
      '+++ b/src/b.ts',
      '@@ -1 +1 @@',
      '-x',
      '+y',
      '',
    ].join('\n')
    await writeFile(join(runDir, 'diff.patch'), diff)

    const proc = Bun.spawn(['bun', CLI, 'shard', runDir, '--budget', '3', '--max-files', '1'], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const stdout = await new Response(proc.stdout).text()
    const exit = await proc.exited
    expect(exit).toBe(0)
    expect(stdout).toContain('2 shard(s)')

    const manifest = JSON.parse(
      await readFile(join(runDir, 'shards', 'manifest.json'), 'utf8'),
    ) as { budget: number; maxFiles: number; shards: unknown[] }
    expect(manifest.budget).toBe(3)
    expect(manifest.maxFiles).toBe(1)
    expect(manifest.shards).toHaveLength(2)
  } finally {
    await rm(runDir, { recursive: true, force: true })
  }
})
