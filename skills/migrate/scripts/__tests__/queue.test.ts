import { afterEach, beforeEach, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeConfig } from '../config.ts'
import { isMissingFrontmatter, loadQueue, parseQueueItem } from '../queue.ts'
import { runQueue } from '../queue-cmd.ts'

let root: string
let queueDir: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'migrate-queue-'))
  queueDir = join(root, '.migrate', 'queue')
  await mkdir(queueDir, { recursive: true })
  await writeConfig(root, { sourcePath: join(root, 'legacy'), scope: 'all', targetName: 'newapp' })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const GOOD = `---
id: q-invoice-batch-scope
severity: moderate
status: open
---

## Evidence

Route POST /api/invoice/batch found in InvoiceController.cs:215-240.

## Options

(a) Replicate as-is. (b) Harden it. (c) Mark out of scope.

## Recommendation

Recommend (c); three invocations in six months.
`

test('a well-formed item parses', () => {
  const result = parseQueueItem(GOOD, join(queueDir, 'q-invoice-batch-scope.md'))
  expect(result.ok).toBe(true)
  if (result.ok) {
    expect(result.value.severity).toBe('moderate')
    expect(result.value.status).toBe('open')
    expect(result.value.evidence).toContain('InvoiceController.cs')
  }
})

test('a filename that does not match the id is rejected', () => {
  const result = parseQueueItem(GOOD, join(queueDir, 'other.md'))
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.errors.join(' ')).toContain('filename')
})

test('an empty section is rejected', () => {
  const text = GOOD.replace('Recommend (c); three invocations in six months.', '')
  const result = parseQueueItem(text, join(queueDir, 'q-invoice-batch-scope.md'))
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.errors.join(' ')).toContain('Recommendation')
})

test('a missing section is rejected', () => {
  const text = GOOD.replace(/## Options[\s\S]*?(?=## Recommendation)/, '')
  const result = parseQueueItem(text, join(queueDir, 'q-invoice-batch-scope.md'))
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.errors.join(' ')).toContain('Options')
})

test('an unknown severity is rejected', () => {
  const text = GOOD.replace('severity: moderate', 'severity: urgent')
  const result = parseQueueItem(text, join(queueDir, 'q-invoice-batch-scope.md'))
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.errors.join(' ')).toContain('severity')
})

test('loadQueue sorts critical first and reports per-file errors', async () => {
  await writeFile(join(queueDir, 'q-invoice-batch-scope.md'), GOOD)
  await writeFile(
    join(queueDir, 'q-zulu.md'),
    GOOD.replace('q-invoice-batch-scope', 'q-zulu').replace(
      'severity: moderate',
      'severity: critical',
    ),
  )
  await writeFile(join(queueDir, 'q-broken.md'), '---\nid: q-broken\n---\n')
  const { items, errors } = await loadQueue(queueDir)
  expect(items.map((i) => i.id)).toEqual(['q-zulu', 'q-invoice-batch-scope'])
  expect(errors.join(' ')).toContain('q-broken')
})

// An adjudicated item requires a ruling: status alone is not enough to
// close out a decision, since 'adjudicated' with no ruling text records
// that a call was made without recording what it was.

test('an adjudicated item with no ruling is rejected', () => {
  const text = GOOD.replace('status: open', 'status: adjudicated')
  const result = parseQueueItem(text, join(queueDir, 'q-invoice-batch-scope.md'))
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.errors.join(' ')).toContain('ruling')
})

test('an adjudicated item with a ruling parses', () => {
  const text = GOOD.replace('status: open', 'status: adjudicated\nruling: out of scope, delta-003')
  const result = parseQueueItem(text, join(queueDir, 'q-invoice-batch-scope.md'))
  expect(result.ok).toBe(true)
  if (result.ok) {
    expect(result.value.status).toBe('adjudicated')
    expect(result.value.ruling).toBe('out of scope, delta-003')
  }
})

// Correction 1: no uncaught throws from the CLI, ever. runQueue reads files
// with readFile; a missing file, a directory passed as a file, or an
// unreadable file must all produce a clean diagnostic and a deliberate exit
// code instead of a raw stack trace escaping the process.

test('queue add reports a missing file as a clean diagnostic, not a thrown stack trace', async () => {
  const code = await runQueue({ root, args: ['add', join(root, 'does-not-exist.md')] })
  expect(code).toBe(2)
})

test('queue add reports a directory passed as a file as a clean diagnostic', async () => {
  const dir = join(root, 'a-directory.md')
  await mkdir(dir)
  const code = await runQueue({ root, args: ['add', dir] })
  expect(code).toBe(2)
})

test('queue add reports an unreadable file as a clean diagnostic', async () => {
  const path = join(root, 'no-access.md')
  await writeFile(path, GOOD)
  await chmod(path, 0o000)
  try {
    const code = await runQueue({ root, args: ['add', path] })
    expect(code).toBe(2)
  } finally {
    await chmod(path, 0o644)
  }
})

test('loadQueue reports a directory named *.md without abandoning the rest of the directory', async () => {
  await writeFile(join(queueDir, 'q-invoice-batch-scope.md'), GOOD)
  await mkdir(join(queueDir, 'q-oops.md'))
  const { items, errors } = await loadQueue(queueDir)
  expect(items.map((i) => i.id)).toEqual(['q-invoice-batch-scope'])
  expect(errors.join(' ')).toContain('q-oops.md')
})

test('loadQueue reports an unreadable file without abandoning the rest of the directory', async () => {
  await writeFile(join(queueDir, 'q-invoice-batch-scope.md'), GOOD)
  const lockedPath = join(queueDir, 'q-locked.md')
  await writeFile(
    lockedPath,
    GOOD.replace('q-invoice-batch-scope', 'q-locked').replace(
      'severity: moderate',
      'severity: critical',
    ),
  )
  await chmod(lockedPath, 0o000)
  try {
    const { items, errors } = await loadQueue(queueDir)
    expect(items.map((i) => i.id)).toEqual(['q-invoice-batch-scope'])
    expect(errors.join(' ')).toContain('q-locked.md')
  } finally {
    await chmod(lockedPath, 0o644)
  }
})

test('loadQueue reports a queue path that is a file, not a directory, without throwing', async () => {
  const notADir = join(root, '.migrate', 'not-a-dir')
  await writeFile(notADir, 'oops')
  const { items, errors } = await loadQueue(notADir)
  expect(items).toEqual([])
  expect(errors.join(' ')).toContain(notADir)
})

// Correction 2: exit-code convention. A queue file that cannot be read or
// has no frontmatter at all is a usage error (2); a queue file that parses
// but violates the grammar is a content failure (1).

test('isMissingFrontmatter is true only for the no-frontmatter case', () => {
  const noFm = parseQueueItem('not frontmatter at all\n', join(queueDir, 'x.md'))
  const badSeverity = parseQueueItem(
    GOOD.replace('severity: moderate', 'severity: urgent'),
    join(queueDir, 'q-invoice-batch-scope.md'),
  )
  if (!noFm.ok) expect(isMissingFrontmatter(noFm.errors)).toBe(true)
  if (!badSeverity.ok) expect(isMissingFrontmatter(badSeverity.errors)).toBe(false)
})

test('queue add rejects a file with no frontmatter at all as a usage error (2)', async () => {
  const path = join(root, 'no-frontmatter.md')
  await writeFile(path, '# Just some markdown\n\nNo frontmatter here.\n')
  const code = await runQueue({ root, args: ['add', path] })
  expect(code).toBe(2)
})

test('queue add rejects a well-formed-but-invalid item as a content failure (1)', async () => {
  const path = join(root, 'q-invoice-batch-scope.md')
  await writeFile(path, GOOD.replace('severity: moderate', 'severity: urgent'))
  const code = await runQueue({ root, args: ['add', path] })
  expect(code).toBe(1)
})

test('queue add rejects an empty section as a content failure (1)', async () => {
  const path = join(root, 'q-invoice-batch-scope.md')
  await writeFile(path, GOOD.replace('Recommend (c); three invocations in six months.', ''))
  const code = await runQueue({ root, args: ['add', path] })
  expect(code).toBe(1)
})

test('queue add accepts a well-formed item and copies it into the store (0)', async () => {
  const path = join(root, 'q-invoice-batch-scope.md')
  await writeFile(path, GOOD)
  const code = await runQueue({ root, args: ['add', path] })
  expect(code).toBe(0)
  expect(existsSync(join(queueDir, 'q-invoice-batch-scope.md'))).toBe(true)
})

test('queue add with no file argument is a usage error (2)', async () => {
  const code = await runQueue({ root, args: ['add'] })
  expect(code).toBe(2)
})

test('queue list reports items and returns 0 when the queue is clean', async () => {
  const path = join(root, 'q-invoice-batch-scope.md')
  await writeFile(path, GOOD)
  await runQueue({ root, args: ['add', path] })
  const code = await runQueue({ root, args: ['list'] })
  expect(code).toBe(0)
})

test('queue list returns 1 when a queue file is broken, without abandoning the listing', async () => {
  await writeFile(join(queueDir, 'q-broken.md'), '---\nid: q-broken\n---\n')
  const code = await runQueue({ root, args: ['list'] })
  expect(code).toBe(1)
})

test('queue show prints the raw file for a known id', async () => {
  await writeFile(join(queueDir, 'q-invoice-batch-scope.md'), GOOD)
  const code = await runQueue({ root, args: ['show', 'q-invoice-batch-scope'] })
  expect(code).toBe(0)
})

test('queue show reports an unknown id as a content failure (1)', async () => {
  const code = await runQueue({ root, args: ['show', 'q-does-not-exist'] })
  expect(code).toBe(1)
})

test('queue show with no id is a usage error (2)', async () => {
  const code = await runQueue({ root, args: ['show'] })
  expect(code).toBe(2)
})

test('queue with an unknown verb is a usage error (2)', async () => {
  const code = await runQueue({ root, args: ['frobnicate'] })
  expect(code).toBe(2)
})

// Critical finding 1: a store configured so its own path resolves inside
// its configured source tree (e.g. source.path pointing at the project
// root itself, which the store also lives under) must not crash.
// assertNotUnderSource throws by design (writeRows's own contract, see
// store.test.ts); queue-cmd.ts must catch that throw and report a clean
// diagnostic with a deliberate exit code instead of letting it escape as
// an uncaught stack trace. Chosen exit code: 2 -- a malformed/unusable
// setup that fails identically no matter what valid file content is
// supplied, not a property of this file's own data (see the report for
// the full argument against exit code 1).

test('queue add refuses to write when the store sits inside its own configured source tree, as a clean usage error (2), not a crash', async () => {
  await writeConfig(root, { sourcePath: root, scope: 'all', targetName: 'newapp' })
  const path = join(root, 'q-invoice-batch-scope.md')
  await writeFile(path, GOOD)
  const code = await runQueue({ root, args: ['add', path] })
  expect(code).toBe(2)
  expect(existsSync(join(queueDir, 'q-invoice-batch-scope.md'))).toBe(false)
})

// Critical finding 2: sectionBody must match headings at a line boundary
// and at exactly level two. Before the fix, '### Options' (one hash too
// many) was invisible to the next-boundary search but still matched by a
// plain indexOf('## Options') substring lookup, so Evidence silently
// absorbed the whole mislabeled Options block (including its own heading)
// while Options was separately (mis)populated from that same text --
// ok:true, corrupted and duplicated, no diagnostic. A duplicated
// '## Evidence' heading similarly truncated Evidence to its first block
// and dropped the second entirely, again ok:true with no diagnostic.

test('a heading one level too deep (### Options) is reported as a missing section, not silently accepted with corrupted content', () => {
  const text = GOOD.replace('## Options', '### Options')
  const result = parseQueueItem(text, join(queueDir, 'q-invoice-batch-scope.md'))
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.errors.join(' ')).toContain('Options')
})

test('a duplicated ## Evidence heading is rejected as a duplicate section, not silently truncated to the first block', () => {
  const text = GOOD.replace(
    '## Evidence\n\nRoute POST /api/invoice/batch found in InvoiceController.cs:215-240.\n',
    '## Evidence\n\nFirst evidence block.\n\n## Evidence\n\nSecond evidence block, silently dropped by the pre-fix code.\n',
  )
  const result = parseQueueItem(text, join(queueDir, 'q-invoice-batch-scope.md'))
  expect(result.ok).toBe(false)
  if (!result.ok) {
    const msg = result.errors.join(' ')
    expect(msg).toContain('Evidence')
    expect(msg.toLowerCase()).toContain('duplicate')
  }
})

test('a level-three sub-heading inside a section is kept as ordinary content, not treated as a boundary', () => {
  const text = GOOD.replace(
    'Route POST /api/invoice/batch found in InvoiceController.cs:215-240.',
    'Route POST /api/invoice/batch found in InvoiceController.cs:215-240.\n\n### Extra detail\n\nAlso seen in the audit log.',
  )
  const result = parseQueueItem(text, join(queueDir, 'q-invoice-batch-scope.md'))
  expect(result.ok).toBe(true)
  if (result.ok) {
    expect(result.value.evidence).toContain('### Extra detail')
    expect(result.value.evidence).toContain('Also seen in the audit log.')
    expect(result.value.options).not.toContain('Extra detail')
  }
})

// Important finding 3: a leading BOM and/or CRLF line endings must not
// reject an otherwise well-formed item wholesale. Both are common
// byproducts of authoring on Windows; neither changes the file's actual
// content, so both are stripped/normalized before any grammar check runs.

test('a leading BOM does not cause a well-formed item to be rejected', () => {
  const result = parseQueueItem(`\uFEFF${GOOD}`, join(queueDir, 'q-invoice-batch-scope.md'))
  expect(result.ok).toBe(true)
})

test('CRLF line endings do not cause a well-formed item to be rejected', () => {
  const crlf = GOOD.replace(/\n/g, '\r\n')
  const result = parseQueueItem(crlf, join(queueDir, 'q-invoice-batch-scope.md'))
  expect(result.ok).toBe(true)
  if (result.ok) {
    expect(result.value.evidence).toContain('InvoiceController.cs')
    expect(result.value.evidence).not.toContain('\r')
  }
})

test('a BOM plus CRLF together do not cause a well-formed item to be rejected', () => {
  const text = `\uFEFF${GOOD.replace(/\n/g, '\r\n')}`
  const result = parseQueueItem(text, join(queueDir, 'q-invoice-batch-scope.md'))
  expect(result.ok).toBe(true)
})

// Minor finding 4: a wrong-case heading (e.g. '## options') reports
// "missing ## Options section" with no hint that case is the problem,
// identical to the message for a heading that's absent entirely. State
// the grammar so the author can tell the two apart.

test('a wrong-case heading names the exact grammar required, not just "missing"', () => {
  const text = GOOD.replace('## Options', '## options')
  const result = parseQueueItem(text, join(queueDir, 'q-invoice-batch-scope.md'))
  expect(result.ok).toBe(false)
  if (!result.ok) {
    const msg = result.errors.join(' ')
    expect(msg).toContain('Options')
    expect(msg).toContain('case-sensitive')
  }
})
