import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test'
import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { formatHandoff, runHandoff } from '../handoff-cmd.ts'
import { diffSha256, localBranchDiff } from '../local-diff.ts'
import type { ReviewFinding } from '../types.ts'

const WARNING = 'Warning: the tree changed since this review began; line anchors may be off.'
const FOOTER = 'Address every must-fix and should-fix, or say why not. The rest are optional.'

const shouldFix: ReviewFinding = {
  id: 'f-should',
  file: 'src/b.ts',
  line: 20,
  severity: 'medium',
  risk: { impact: 'medium', likelihood: 'possible', confidence: 'medium', action: 'should-fix' },
  title: 'Retry count is off by one',
  description: 'Observation: the loop retries four times instead of three.',
  domain: null,
}

const mustFix: ReviewFinding = {
  id: 'f-must',
  file: 'src/a.ts',
  line: 10,
  severity: 'blocker',
  risk: { impact: 'critical', likelihood: 'likely', confidence: 'high', action: 'must-fix' },
  title: 'Token leaks into the log',
  description: 'Observation: the bearer token is written to stdout.',
  suggestion: { body: 'log.info(redact(token))', startLine: 10, endLine: 10 },
  domain: null,
}

const consider: ReviewFinding = {
  id: 'f-consider',
  file: 'README.md',
  line: null,
  severity: 'low',
  risk: { impact: 'low', likelihood: 'edge-case', confidence: 'low', action: 'consider' },
  title: 'Mention the new flag',
  description: 'Observation: the flag is undocumented.',
  domain: null,
}

const optional: ReviewFinding = {
  id: 'f-optional',
  file: 'src/c.ts',
  line: 3,
  severity: 'low',
  risk: { impact: 'low', likelihood: 'edge-case', confidence: 'low', action: 'optional' },
  title: 'Name the constant',
  description: 'Observation: the magic number has no name.',
  domain: null,
}

const findings = [shouldFix, consider, mustFix, optional]

function render(stale: boolean): string {
  return formatHandoff({
    target: 'local branch feat/x against main',
    findings,
    stale,
  })
}

test('formatHandoff opens with the target header', () => {
  expect(render(false).split('\n')[0]).toBe(
    '# magpie local review: local branch feat/x against main',
  )
})

test('formatHandoff counts consider and optional together as optional', () => {
  expect(render(false)).toContain('1 must-fix, 1 should-fix, 2 optional')
})

test('formatHandoff goes straight from the counts to the first finding', () => {
  expect(render(false)).toContain(
    '1 must-fix, 1 should-fix, 2 optional\n\n1. [must-fix] src/a.ts:10: Token leaks into the log',
  )
})

test('formatHandoff numbers actionable findings by risk, then suggestions', () => {
  const out = render(false)
  const first = out.indexOf('1. [must-fix] src/a.ts:10: Token leaks into the log')
  const second = out.indexOf('2. [should-fix] src/b.ts:20: Retry count is off by one')
  const third = out.indexOf('3. [consider] README.md: Mention the new flag')
  const fourth = out.indexOf('4. [optional] src/c.ts:3: Name the constant')
  expect(first).toBeGreaterThan(-1)
  expect(second).toBeGreaterThan(first)
  expect(third).toBeGreaterThan(second)
  expect(fourth).toBeGreaterThan(third)
})

test('formatHandoff renders each description as markdown sections', () => {
  expect(render(false)).toContain('**Observation:** the bearer token is written to stdout.')
})

test('formatHandoff fences the suggestion body under a single-line label', () => {
  expect(render(false)).toContain(
    'Suggested replacement for line 10:\n```\nlog.info(redact(token))\n```',
  )
})

function renderOne(suggestion: ReviewFinding['suggestion']): string {
  return formatHandoff({
    target: 't',
    findings: [{ ...mustFix, suggestion }],
    stale: false,
  })
}

test('formatHandoff labels a multi-line suggestion with its line range', () => {
  expect(renderOne({ body: 'a()\nb()', startLine: 4, endLine: 5 })).toContain(
    'Suggested replacement for lines 4-5:\n```\na()\nb()\n```',
  )
})

test('formatHandoff fences a body holding backticks one backtick longer', () => {
  const body = 'doc = `\n```\n`'
  expect(renderOne({ body, startLine: 1, endLine: 3 })).toContain(`\`\`\`\`\n${body}\n\`\`\`\``)
})

test('formatHandoff ends with the footer', () => {
  expect(render(false).trimEnd().endsWith(FOOTER)).toBe(true)
})

test('formatHandoff puts the stale warning directly after the header', () => {
  const lines = render(true).split('\n')
  expect(lines[1]).toBe(WARNING)
})

test('formatHandoff omits the stale warning when fresh', () => {
  expect(render(false)).not.toContain('Warning:')
})

test('formatHandoff with no findings prints only the header and No findings.', () => {
  const out = formatHandoff({ target: 't', findings: [], stale: false })
  expect(out).toBe('# magpie local review: t\n\nNo findings.\n')
})

let repo: string
let runDir: string
let stdout: string
let stderr: string

async function sh(cwd: string, ...cmd: string[]): Promise<void> {
  const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' })
  const exit = await proc.exited
  if (exit !== 0) {
    const err = await new Response(proc.stderr).text()
    throw new Error(`${cmd.join(' ')} exit ${exit}: ${err}`)
  }
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'magpie-handoff-repo-'))
  runDir = await mkdtemp(join(tmpdir(), 'magpie-handoff-run-'))
  await sh(repo, 'git', 'init', '-q', '-b', 'main')
  await sh(repo, 'git', 'config', 'user.email', 't@t.t')
  await sh(repo, 'git', 'config', 'user.name', 't')
  await sh(repo, 'git', 'config', 'commit.gpgsign', 'false')
  await writeFile(join(repo, 'a.txt'), 'one\n')
  await sh(repo, 'git', 'add', '.')
  await sh(repo, 'git', 'commit', '-q', '-m', 'init')
  await sh(repo, 'git', 'checkout', '-q', '-b', 'feat/x')
  await writeFile(join(repo, 'a.txt'), 'one\ntwo\n')
  await sh(repo, 'git', 'commit', '-q', '-am', 'add two')
  stdout = ''
  stderr = ''
  spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stdout += String(chunk)
    return true
  })
  spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stderr += String(chunk)
    return true
  })
})

afterEach(async () => {
  mock.restore()
  await rm(repo, { recursive: true, force: true })
  await rm(runDir, { recursive: true, force: true })
})

async function writeLocalRun(): Promise<void> {
  const r = await localBranchDiff({ gitBin: 'git', repoPath: repo, baseRef: 'main' })
  if (!r.ok) throw new Error(r.error)
  await writeFile(join(runDir, 'target.json'), JSON.stringify({ mode: 'local', root: repo }))
  await writeFile(
    join(runDir, 'local.json'),
    JSON.stringify({
      branch: 'feat/x',
      baseRef: 'main',
      mergeBase: r.mergeBase,
      head: r.head,
      dirty: false,
      author: 't',
      commits: [],
      intentFile: null,
    }),
  )
  await writeFile(join(runDir, 'findings.final.json'), JSON.stringify([mustFix]))
  await writeFile(
    join(runDir, 'diff-source.json'),
    JSON.stringify({
      source: 'local',
      mergeBase: r.mergeBase,
      baseRef: r.baseRef,
      head: r.head,
      diffSha256: diffSha256(r.diff),
    }),
  )
}

test('runHandoff prints a fresh handoff for an unchanged tree', async () => {
  await writeLocalRun()
  const exit = await runHandoff(runDir)
  expect(exit).toBe(0)
  expect(stdout).toContain('# magpie local review: local branch feat/x against main')
  expect(stdout).toContain('1. [must-fix] src/a.ts:10: Token leaks into the log')
  expect(stdout).not.toContain(WARNING)
})

test('runHandoff logs a done handoff entry with the finding count', async () => {
  await writeLocalRun()
  await runHandoff(runDir)
  const lines = (await readFile(join(runDir, 'log.jsonl'), 'utf8')).trim().split('\n')
  const entry = JSON.parse(lines[lines.length - 1] as string)
  expect(entry.stage).toBe('handoff')
  expect(entry.status).toBe('done')
  expect(entry.findings).toBe(1)
})

test('runHandoff warns when the tree changed after the review began', async () => {
  await writeLocalRun()
  await writeFile(join(repo, 'a.txt'), 'one\ntwo\nthree\n')
  const exit = await runHandoff(runDir)
  expect(exit).toBe(0)
  expect(stdout).toContain(WARNING)
})

test('runHandoff warns after a same-size edit made in the same second as the last index write', async () => {
  // b.txt matches the merge base, so git trusts the index alone to call it unchanged.
  await sh(repo, 'git', 'checkout', '-q', 'main')
  await writeFile(join(repo, 'b.txt'), 'bee\n')
  await sh(repo, 'git', 'add', 'b.txt')
  await sh(repo, 'git', 'commit', '-q', '-m', 'add b')
  await sh(repo, 'git', 'checkout', '-q', 'feat/x')
  await sh(repo, 'git', 'rebase', '-q', 'main')
  await writeLocalRun()
  // Pinning b.txt and the index to one whole second reproduces the racy case
  // without waiting on the clock; trustctime=false because ctime cannot be set.
  await sh(repo, 'git', 'config', 'core.trustctime', 'false')
  const second = new Date('2020-01-01T00:00:00Z')
  await utimes(join(repo, 'b.txt'), second, second)
  await sh(repo, 'git', 'update-index', '--refresh')
  await writeFile(join(repo, 'b.txt'), 'bed\n')
  await utimes(join(repo, 'b.txt'), second, second)
  await utimes(join(repo, '.git', 'index'), second, second)
  const exit = await runHandoff(runDir)
  expect(exit).toBe(0)
  expect(stdout).toContain(WARNING)
})

test('runHandoff names a detached HEAD in the target', async () => {
  await writeLocalRun()
  const meta = JSON.parse(await readFile(join(runDir, 'local.json'), 'utf8'))
  await writeFile(join(runDir, 'local.json'), JSON.stringify({ ...meta, branch: null }))
  await runHandoff(runDir)
  expect(stdout).toContain('# magpie local review: detached HEAD against main')
})

test('runHandoff refuses a PR-mode run with exit 2', async () => {
  await writeFile(join(runDir, 'target.json'), JSON.stringify({ mode: 'pr', root: repo }))
  const exit = await runHandoff(runDir)
  expect(exit).toBe(2)
  expect(stderr).toContain('magpie: handoff')
})

test('runHandoff returns 4 when findings.final.json is missing', async () => {
  await writeLocalRun()
  await rm(join(runDir, 'findings.final.json'))
  expect(await runHandoff(runDir)).toBe(4)
})

test('runHandoff returns 4 when local.json is missing', async () => {
  await writeLocalRun()
  await rm(join(runDir, 'local.json'))
  expect(await runHandoff(runDir)).toBe(4)
})

test('runHandoff reports a failed recompute as stale', async () => {
  await writeLocalRun()
  const meta = JSON.parse(await readFile(join(runDir, 'local.json'), 'utf8'))
  await writeFile(join(runDir, 'local.json'), JSON.stringify({ ...meta, baseRef: 'no-such-ref' }))
  expect(await runHandoff(runDir)).toBe(0)
  expect(stdout).toContain(WARNING)
})

test('runHandoff reports a diff-source.json without diffSha256 as stale', async () => {
  await writeLocalRun()
  const source = JSON.parse(await readFile(join(runDir, 'diff-source.json'), 'utf8'))
  delete source.diffSha256
  await writeFile(join(runDir, 'diff-source.json'), JSON.stringify(source))
  expect(await runHandoff(runDir)).toBe(0)
  expect(stdout).toContain(WARNING)
})

test('runHandoff still prints, stale, when the review root is gone', async () => {
  await writeLocalRun()
  const gone = await mkdtemp(join(tmpdir(), 'magpie-handoff-gone-'))
  await rm(gone, { recursive: true, force: true })
  await writeFile(join(runDir, 'target.json'), JSON.stringify({ mode: 'local', root: gone }))
  expect(await runHandoff(runDir)).toBe(0)
  expect(stdout).toContain(WARNING)
  expect(stderr).toContain('magpie: handoff: could not recompute the diff: ')
})
