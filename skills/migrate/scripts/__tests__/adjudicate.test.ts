import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyRuling, renderReviewSheet } from '../adjudicate-cmd.ts'
import type { QueueItem } from '../types.ts'

const CLI = join(import.meta.dir, '..', '..', 'bin', 'migrate.ts')

let target: string
let source: string

async function migrate(args: string[]): Promise<{ code: number; out: string; err: string }> {
  const proc = Bun.spawn(['bun', CLI, ...args], { cwd: target, stdout: 'pipe', stderr: 'pipe' })
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  await proc.exited
  return { code: proc.exitCode ?? -1, out, err }
}

function item(id: string, severity: string, extra = ''): string {
  return `---
id: ${id}
severity: ${severity}
status: open
${extra}---

## Evidence

Two tables both look like they own the join.

## Options

1. Give it to billing.
2. Give it to scheduling.

## Recommendation

Billing owns it, on the strength of the write sites.
`
}

async function addItem(id: string, severity: string, extra = ''): Promise<void> {
  const path = join(target, `${id}.md`)
  await writeFile(path, item(id, severity, extra))
  const added = await migrate(['queue', 'add', path])
  expect(added.code).toBe(0)
}

beforeEach(async () => {
  target = await mkdtemp(join(tmpdir(), 'migrate-adjudicate-'))
  source = join(target, 'legacy')
  await Bun.write(join(source, 'app.js'), '// legacy\n')
  const init = await migrate(['init', '--source', source, '--scope', 'x', '--name', 'target'])
  expect(init.code).toBe(0)
})

afterEach(async () => {
  await rm(target, { recursive: true, force: true })
})

// --- applyRuling, pure ---

test('applyRuling keeps unowned keys in place and the body byte-identical', () => {
  const body = `
## Evidence

A body with a --- line inside it:

---

and a fenced block:

\`\`\`
status: open
ruling: not a real key
\`\`\`

## Options

Only one.

## Recommendation

Take it.
`
  // `severity` deliberately sits AFTER `status`, the one owned key already
  // present. With the owned key last, an implementation that simply dropped
  // owned keys and appended them would produce the same output as one that
  // replaces in place, and this test would assert nothing about position.
  const before = `---
id: q-table-ownership
owner: dik
status: open
severity: critical
---${body}`

  const after = applyRuling(before, 'billing owns it', '2026-08-13')

  // Body preserved byte for byte, including the --- line and the fence.
  expect(after.slice(after.indexOf('\n---', 3) + 4)).toBe(body)
  const fm = after.slice(4, after.indexOf('\n---', 3))
  expect(fm.split('\n')).toEqual([
    'id: q-table-ownership',
    'owner: dik',
    'status: adjudicated',
    'severity: critical',
    'ruling: billing owns it',
    'adjudicated: 2026-08-13',
  ])
})

test('applyRuling rewrites an existing ruling in place rather than appending a second', () => {
  const before = `---
id: q-x
severity: minor
status: adjudicated
ruling: an earlier call
adjudicated: 2026-08-01
---

## Evidence

e

## Options

o

## Recommendation

r
`
  const after = applyRuling(before, 'the revised call', '2026-08-13')
  const fm = after.slice(4, after.indexOf('\n---', 3))
  expect(fm.split('\n')).toEqual([
    'id: q-x',
    'severity: minor',
    'status: adjudicated',
    'ruling: the revised call',
    'adjudicated: 2026-08-13',
  ])
  expect(after.match(/^ruling:/gm)).toHaveLength(1)
})

test('applyRuling refuses a ruling that would break the frontmatter it writes into', () => {
  const before = item('q-x', 'minor')
  // A line break is the whole hazard: it lets the value inject further
  // frontmatter keys, or a closing fence. A value of '---' is not a hazard,
  // because it is written as `ruling: ---` and so never sits at line start.
  expect(() => applyRuling(before, 'line one\nline two', '2026-08-13')).toThrow(/newline/)
  expect(() => applyRuling(before, 'line one\rline two', '2026-08-13')).toThrow(/newline/)
  expect(() => applyRuling(before, '   ', '2026-08-13')).toThrow(/empty/)
  expect(applyRuling(before, '---', '2026-08-13')).toContain('ruling: ---')
})

// --- renderReviewSheet, pure ---

test('renderReviewSheet is severity-ordered, carries each recommendation, and counts open', () => {
  const items: QueueItem[] = [
    {
      id: 'q-minor-thing',
      severity: 'minor',
      status: 'open',
      evidence: 'e',
      options: 'o',
      recommendation: 'Leave it alone.\nA second line nobody needs here.',
      path: 'p',
    },
    {
      id: 'q-big-thing',
      severity: 'critical',
      status: 'adjudicated',
      ruling: 'done already',
      evidence: 'e',
      options: 'o',
      recommendation: 'Split the table.',
      path: 'p',
    },
  ]
  expect(renderReviewSheet(items)).toBe(
    [
      'q-big-thing [critical] adjudicated - Split the table.',
      'q-minor-thing [minor] open - Leave it alone.',
      '',
      '1 open',
    ].join('\n'),
  )
})

// --- the verb ---

test('adjudicate with no id prints the review sheet', async () => {
  await addItem('q-alpha', 'critical')
  await addItem('q-beta', 'minor')

  const sheet = await migrate(['adjudicate'])
  expect(sheet.code).toBe(0)
  expect(sheet.out).toContain('q-alpha [critical] open - Billing owns it')
  expect(sheet.out).toContain('q-beta [minor] open')
  expect(sheet.out).toContain('2 open')
})

test('adjudicate records a ruling, flips status, and records a batch', async () => {
  await addItem('q-alpha', 'critical')

  const ruled = await migrate(['adjudicate', 'q-alpha', '--ruling', 'billing owns it'])
  expect(ruled.code).toBe(0)
  expect(ruled.out).toContain('q-alpha')
  expect(ruled.out).toContain('open -> adjudicated')
  // The verb points at the writer that applies the consequence, since it does
  // not touch the row files itself.
  expect(ruled.out).toContain('migrate import')

  const text = await readFile(join(target, '.migrate', 'queue', 'q-alpha.md'), 'utf8')
  expect(text).toContain('status: adjudicated')
  expect(text).toContain('ruling: billing owns it')
  expect(text).toMatch(/adjudicated: \d{4}-\d{2}-\d{2}/)
  // The body survived.
  expect(text).toContain('Two tables both look like they own the join.')

  const phases = JSON.parse(await readFile(join(target, '.migrate', 'phases.json'), 'utf8'))
  expect(phases.phases.adjudicate.batches).toHaveLength(1)
  expect(phases.phases.adjudicate.batches[0].id).toBe('b-adjudicate-q-alpha')
})

test('adjudicate refuses an unknown id as a usage error', async () => {
  await addItem('q-alpha', 'critical')
  const missing = await migrate(['adjudicate', 'q-nope', '--ruling', 'x'])
  expect(missing.code).toBe(2)
  expect(missing.err).toContain('q-nope')
})

test('adjudicate refuses to overwrite an existing ruling without --force', async () => {
  await addItem('q-alpha', 'critical')
  await migrate(['adjudicate', 'q-alpha', '--ruling', 'the first call'])

  const again = await migrate(['adjudicate', 'q-alpha', '--ruling', 'a different call'])
  expect(again.code).toBe(1)
  // The existing ruling is printed, so the caller sees what they would have lost.
  expect(again.err).toContain('the first call')
  expect(again.err).toContain('--force')

  const forced = await migrate(['adjudicate', 'q-alpha', '--ruling', 'a different call', '--force'])
  expect(forced.code).toBe(0)
  const text = await readFile(join(target, '.migrate', 'queue', 'q-alpha.md'), 'utf8')
  expect(text).toContain('ruling: a different call')
})

test('adjudicate refuses a ruling containing a newline', async () => {
  await addItem('q-alpha', 'critical')
  const bad = await migrate(['adjudicate', 'q-alpha', '--ruling', 'one\ntwo'])
  expect(bad.code).toBe(2)
  expect(bad.err).toContain('newline')
})

test('adjudicate reports a queue file that will not parse as a content failure', async () => {
  await addItem('q-alpha', 'critical')
  // Break the file after it is in the store: an empty Options section.
  const path = join(target, '.migrate', 'queue', 'q-alpha.md')
  const text = await readFile(path, 'utf8')
  await writeFile(path, text.replace('1. Give it to billing.\n2. Give it to scheduling.\n', ''))

  const broken = await migrate(['adjudicate', 'q-alpha', '--ruling', 'x'])
  expect(broken.code).toBe(1)
  expect(broken.err).toContain('q-alpha')
})
