import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runRender } from '../render-cmd.ts'

let runDir: string

beforeEach(async () => {
  runDir = await mkdtemp(join(tmpdir(), 'magpie-render-'))
  await mkdir(join(runDir, 'screen'), { recursive: true })
  await mkdir(join(runDir, 'state'), { recursive: true })
  await writeFile(
    join(runDir, 'pr.json'),
    JSON.stringify({
      number: 1234,
      headRefName: 'feature-x',
      headRefOid: 'deadbeef',
    }),
  )
})

afterEach(async () => {
  await rm(runDir, { recursive: true, force: true })
})

test('progress render writes screen/progress.html on first call', async () => {
  await writeFile(join(runDir, 'log.jsonl'), '')
  const exit = await runRender(runDir, 'progress')
  expect(exit).toBe(0)
  const files = await readdir(join(runDir, 'screen'))
  expect(files).toContain('progress.html')
})

test('subsequent progress renders use -v2, -v3 names', async () => {
  await writeFile(join(runDir, 'log.jsonl'), '')
  await runRender(runDir, 'progress')
  await runRender(runDir, 'progress')
  await runRender(runDir, 'progress')
  const files = await readdir(join(runDir, 'screen'))
  expect(files.sort()).toEqual(['progress-v2.html', 'progress-v3.html', 'progress.html'])
})

test('findings render reads findings.final.json if present', async () => {
  await writeFile(
    join(runDir, 'findings.final.json'),
    JSON.stringify([
      {
        id: 'a',
        file: 'src/x.ts',
        line: 1,
        severity: 'high',
        risk: { impact: 'high', likelihood: 'likely', confidence: 'high', action: 'must-fix' },
        title: 'tsst',
        description: 'd',
        domain: 'bugs',
      },
    ]),
  )
  const exit = await runRender(runDir, 'findings')
  expect(exit).toBe(0)
  const html = await Bun.file(join(runDir, 'screen', 'findings.html')).text()
  expect(html).toContain('tsst')
})

test('findings render with no findings json shows empty state', async () => {
  const exit = await runRender(runDir, 'findings')
  expect(exit).toBe(0)
  const html = await Bun.file(join(runDir, 'screen', 'findings.html')).text()
  expect(html).toContain('No findings')
})

test('findings render includes files and diff when provided', async () => {
  await writeFile(
    join(runDir, 'findings.final.json'),
    JSON.stringify([
      {
        id: 'a',
        file: 'src/app.ts',
        line: 5,
        severity: 'high',
        risk: { impact: 'high', likelihood: 'likely', confidence: 'high', action: 'must-fix' },
        title: 'test finding',
        description: 'd',
        domain: 'bugs',
      },
    ]),
  )
  await writeFile(
    join(runDir, 'pr.json'),
    JSON.stringify({
      number: 1234,
      headRefName: 'feature-x',
      headRefOid: 'deadbeef',
      files: [
        { path: 'src/app.ts', additions: 10, deletions: 2 },
        { path: 'src/util.ts', additions: 5, deletions: 0 },
      ],
    }),
  )
  await writeFile(
    join(runDir, 'diff.patch'),
    `--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,6 @@
 function hello() {
+  console.log('added');
+  console.log('more');
 }
`,
  )
  const exit = await runRender(runDir, 'findings')
  expect(exit).toBe(0)
  const html = await Bun.file(join(runDir, 'screen', 'findings.html')).text()
  expect(html).toContain('data-file-pane="src/app.ts"')
  expect(html).toContain('data-file-pane="src/util.ts"')
})

test('findings render includes the brief header when brief.json is present', async () => {
  await writeFile(join(runDir, 'findings.final.json'), JSON.stringify([]))
  await writeFile(
    join(runDir, 'brief.json'),
    JSON.stringify({
      purpose: 'Adds bounded retries to the upload path.',
      changes: ['Wraps the S3 put in a bounded retry'],
      subsystems: [{ name: 'upload', role: 'owns the put path' }],
      watchItems: [],
      unclear: [],
    }),
  )
  expect(await runRender(runDir, 'findings')).toBe(0)
  const html = await readFile(join(runDir, 'screen', 'findings.html'), 'utf8')
  expect(html).toContain('class="pr-brief"')
  expect(html).toContain('Adds bounded retries to the upload path.')
})

test('findings render omits the brief header when brief.json is absent', async () => {
  await writeFile(join(runDir, 'findings.final.json'), JSON.stringify([]))
  expect(await runRender(runDir, 'findings')).toBe(0)
  const html = await readFile(join(runDir, 'screen', 'findings.html'), 'utf8')
  expect(html).not.toContain('class="pr-brief"')
})

test('a malformed brief.json degrades to no header instead of failing the render', async () => {
  await writeFile(join(runDir, 'findings.final.json'), JSON.stringify([]))
  await writeFile(join(runDir, 'brief.json'), '{ this is not json')
  expect(await runRender(runDir, 'findings')).toBe(0)
  const html = await readFile(join(runDir, 'screen', 'findings.html'), 'utf8')
  expect(html).not.toContain('class="pr-brief"')
})

test('linked issues from pr.json render in the brief header', async () => {
  await writeFile(join(runDir, 'findings.final.json'), JSON.stringify([]))
  await writeFile(
    join(runDir, 'pr.json'),
    JSON.stringify({
      number: 1234,
      headRefName: 'feature-x',
      headRefOid: 'deadbeef',
      closingIssuesReferences: [
        { number: 42, title: 'Uploads fail', url: 'https://example.test/issues/42' },
      ],
    }),
  )
  await writeFile(join(runDir, 'brief.json'), JSON.stringify({ purpose: 'Fixes uploads.' }))
  expect(await runRender(runDir, 'findings')).toBe(0)
  const html = await readFile(join(runDir, 'screen', 'findings.html'), 'utf8')
  expect(html).toContain('https://example.test/issues/42')
})

test('issue entries with a missing, zero, or negative number are dropped, not defaulted to 0', async () => {
  await writeFile(join(runDir, 'findings.final.json'), JSON.stringify([]))
  await writeFile(
    join(runDir, 'pr.json'),
    JSON.stringify({
      number: 1234,
      headRefName: 'feature-x',
      headRefOid: 'deadbeef',
      closingIssuesReferences: [
        { number: 42, title: 'Uploads fail', url: 'https://example.test/issues/42' },
        { title: 'Missing number', url: 'https://example.test/issues/missing' },
        { number: 0, title: 'Zero number', url: 'https://example.test/issues/zero' },
        { number: -1, title: 'Negative number', url: 'https://example.test/issues/negative' },
      ],
    }),
  )
  await writeFile(join(runDir, 'brief.json'), JSON.stringify({ purpose: 'Fixes uploads.' }))
  expect(await runRender(runDir, 'findings')).toBe(0)
  const html = await readFile(join(runDir, 'screen', 'findings.html'), 'utf8')
  expect(html).toContain('https://example.test/issues/42')
  expect(html).not.toContain('https://example.test/issues/missing')
  expect(html).not.toContain('https://example.test/issues/zero')
  expect(html).not.toContain('https://example.test/issues/negative')
})

test('progress sums specialist counts across shards', async () => {
  await mkdir(join(runDir, 'shards'), { recursive: true })
  await writeFile(
    join(runDir, 'shards', 'manifest.json'),
    JSON.stringify({
      budget: 6000,
      maxFiles: 80,
      totalFiles: 2,
      totalLines: 20,
      shards: [
        { id: 1, path: 'shards/shard-1.patch', files: ['a.ts'], lines: 10 },
        { id: 2, path: 'shards/shard-2.patch', files: ['b.ts'], lines: 10 },
      ],
    }),
  )
  await writeFile(
    join(runDir, 'log.jsonl'),
    [
      JSON.stringify({ stage: 'specialists', status: 'running' }),
      JSON.stringify({
        stage: 'specialist',
        focus: 'security',
        shard: 1,
        status: 'done',
        findings: 2,
      }),
      JSON.stringify({
        stage: 'specialist',
        focus: 'security',
        shard: 2,
        status: 'done',
        findings: 3,
      }),
      JSON.stringify({ stage: 'specialist', focus: 'bugs', shard: 1, status: 'done', findings: 1 }),
    ].join('\n'),
  )
  const exit = await runRender(runDir, 'progress')
  expect(exit).toBe(0)
  const html = await readFile(join(runDir, 'screen', 'progress.html'), 'utf8')
  expect(html).toContain('Five reviewers across 2 shards')
  // security is 2 + 3, not 3.
  expect(html).toContain('security <span class="count">5</span>')
})

test('progress re-dispatch of one shard replaces rather than doubles its count', async () => {
  await writeFile(
    join(runDir, 'log.jsonl'),
    [
      JSON.stringify({ stage: 'specialists', status: 'running' }),
      JSON.stringify({ stage: 'specialist', focus: 'bugs', shard: 1, status: 'done', findings: 4 }),
      JSON.stringify({ stage: 'specialist', focus: 'bugs', shard: 1, status: 'done', findings: 2 }),
    ].join('\n'),
  )
  const exit = await runRender(runDir, 'progress')
  expect(exit).toBe(0)
  const html = await readFile(join(runDir, 'screen', 'progress.html'), 'utf8')
  expect(html).toContain('bugs <span class="count">2</span>')
})
