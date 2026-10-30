import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { appendFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { readImpactMap, runImpact } from '../impact-cmd.ts'
import { runRender } from '../render-cmd.ts'
import { runStatus, type StatusResult } from '../status-cmd.ts'
import { git } from './helpers/git-fixture.ts'

const CLI = new URL('../../bin/magpie.ts', import.meta.url).pathname

const BASE_FILES: Record<string, string> = {
  'src/report.ts': `export function sealReport(id: string) {
  const label = 'sealed'
  const prefix = 'report'
  const suffix = 'done'
  return \`\${prefix}:\${id}:\${label}:\${suffix}\`
}
`,
  'src/close.ts': `export function closeReport(id: string) {
  return sealReport(id)
}
`,
  'src/archive.ts': `export function archiveReport(id: string) {
  const sealed = sealReport(id)
  return sealed
}
`,
  'src/lock-writer.ts': `export function lockReport(id: string) {
  return db.insert(reportLocks).values({ id })
}
`,
  'src/routes.ts': `export const routes = {
  video: '/api/locks/video',
}
`,
  'docs/design.md': `# Design

Sealing goes through \`sealReport\` before archive.
`,
  // A build output calling sealReport: the default path filter drops dist/.
  'dist/bundle.js': `sealReport(x)
`,
  'notes.txt': `draft one
`,
}

const HEAD_FILES: Record<string, string> = {
  'src/report.ts': `export function sealReport(id: string) {
  const label = 'sealed'
  const prefix = 'report'
  const suffix = 'done'
  const locks = db.select().from(reportLocks)
  return \`\${prefix}:\${id}:\${label}:\${suffix}:\${locks.length}\`
}
`,
  'src/routes.ts': `export const routes = {
  video: '/api/locks/video',
  report: '/api/locks/report',
}
`,
  'notes.txt': `draft two
`,
}

let repo: string
let diff: string
let runDir: string
const tempDirs: string[] = []

async function writeFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), text)
  }
}

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

beforeAll(async () => {
  repo = await tempDir('magpie-impact-repo-')
  await git(repo, 'init', '-b', 'main')
  await git(repo, 'config', 'user.email', 'test@example.com')
  await git(repo, 'config', 'user.name', 'Test')
  await writeFiles(repo, BASE_FILES)
  await git(repo, 'add', '.')
  await git(repo, 'commit', '-m', 'base')
  await writeFiles(repo, HEAD_FILES)
  await git(repo, 'commit', '-am', 'change')
  diff = `${await git(repo, 'diff', 'HEAD~1', 'HEAD')}\n`
})

afterAll(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true })
})

const TWO_SHARDS = {
  budget: 6000,
  maxFiles: 80,
  totalFiles: 3,
  totalLines: 30,
  shards: [
    { id: 1, path: 'shards/shard-1.patch', files: ['src/report.ts'], lines: 20 },
    { id: 2, path: 'shards/shard-2.patch', files: ['notes.txt'], lines: 5 },
  ],
}

async function makeRunDir(root: string): Promise<string> {
  const dir = await tempDir('magpie-impact-run-')
  await writeFile(join(dir, 'diff.patch'), diff)
  await writeFile(join(dir, 'target.json'), JSON.stringify({ mode: 'pr', root }))
  await mkdir(join(dir, 'shards'))
  await writeFile(join(dir, 'shards', 'manifest.json'), JSON.stringify(TWO_SHARDS))
  await writeFile(join(dir, 'log.jsonl'), `${JSON.stringify({ stage: 'setup', status: 'done' })}\n`)
  return dir
}

async function logEntries(dir: string): Promise<Array<Record<string, unknown>>> {
  const text = await readFile(join(dir, 'log.jsonl'), 'utf8')
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

async function impactFiles(dir: string): Promise<string[]> {
  return (await readdir(dir)).filter((name) => name.startsWith('impact')).sort()
}

const REPORT_SHARD_MD = `### Other writers of the same data
- \`reportLocks\` (diff: src/report.ts:5)
  - src/lock-writer.ts:2 \`return db.insert(reportLocks).values({ id })\`

### References to changed symbols
- \`sealReport\` (diff: src/report.ts:2)
  - docs/design.md:3 \`\` Sealing goes through \`sealReport\` before archive. \`\`
  - src/archive.ts:2 \`const sealed = sealReport(id)\`
  - src/close.ts:2 \`return sealReport(id)\`
  - src/report.ts:1 \`export function sealReport(id: string) {\`

### Docs naming what changed
- docs/design.md:3 \`\` Sealing goes through \`sealReport\` before archive. \`\` (names: sealReport)
`

const ROUTES_MD = `### Sibling routes
- \`/api/locks/report\` (diff: src/routes.ts:3)
  - src/routes.ts:2 \`video: '/api/locks/video',\`
`

describe('runImpact on a sharded PR run', () => {
  beforeEach(async () => {
    runDir = await makeRunDir(repo)
  })

  test('impact.json lists the callers, the writer, the sibling route and the doc line', async () => {
    expect(await runImpact(runDir)).toBe(0)
    const map = JSON.parse(await readFile(join(runDir, 'impact.json'), 'utf8'))
    expect(map).toEqual({
      version: 1,
      symbols: [
        {
          name: 'sealReport',
          kind: 'changed',
          definedAt: [{ file: 'src/report.ts', line: 2 }],
          shard: 1,
          hits: 4,
          references: [
            {
              file: 'docs/design.md',
              line: 3,
              text: 'Sealing goes through `sealReport` before archive.',
            },
            { file: 'src/archive.ts', line: 2, text: 'const sealed = sealReport(id)' },
            { file: 'src/close.ts', line: 2, text: 'return sealReport(id)' },
            { file: 'src/report.ts', line: 1, text: 'export function sealReport(id: string) {' },
          ],
        },
      ],
      uses: [],
      stores: [
        {
          name: 'reportLocks',
          kind: 'table',
          usedIn: [{ file: 'src/report.ts', line: 5 }],
          shard: 1,
          writers: [
            {
              file: 'src/lock-writer.ts',
              line: 2,
              text: 'return db.insert(reportLocks).values({ id })',
            },
          ],
        },
      ],
      routes: [
        {
          path: '/api/locks/report',
          usedIn: { file: 'src/routes.ts', line: 3 },
          shard: null,
          siblings: [{ file: 'src/routes.ts', line: 2, text: "video: '/api/locks/video'," }],
        },
      ],
      docs: [
        {
          file: 'docs/design.md',
          line: 3,
          text: 'Sealing goes through `sealReport` before archive.',
          mentions: ['sealReport'],
          shards: [1],
        },
      ],
    })
  })

  test('impact.md renders every entry, the unsharded route included', async () => {
    await runImpact(runDir)
    const [writers, symbols, docs] = REPORT_SHARD_MD.split('\n\n')
    expect(await readFile(join(runDir, 'impact.md'), 'utf8')).toBe(
      `${writers}\n\n${symbols}\n\n${ROUTES_MD}\n${docs}`,
    )
  })

  test('impact.brief.md caps each entry at three children', async () => {
    await runImpact(runDir)
    expect(await readFile(join(runDir, 'impact.brief.md'), 'utf8')).toBe(
      `### Other writers of the same data
- \`reportLocks\` (diff: src/report.ts:5)
  - src/lock-writer.ts:2 \`return db.insert(reportLocks).values({ id })\`

### References to changed symbols
- \`sealReport\` (diff: src/report.ts:2)
  - docs/design.md:3 \`\` Sealing goes through \`sealReport\` before archive. \`\`
  - src/archive.ts:2 \`const sealed = sealReport(id)\`
  - src/close.ts:2 \`return sealReport(id)\`
  - 3 of 4 shown

### Sibling routes
- \`/api/locks/report\` (diff: src/routes.ts:3)
  - src/routes.ts:2 \`video: '/api/locks/video',\`

### Docs naming what changed
- docs/design.md:3 \`\` Sealing goes through \`sealReport\` before archive. \`\` (names: sealReport)
`,
    )
  })

  test('impact.shard-1.md holds only shard 1 entries', async () => {
    await runImpact(runDir)
    expect(await readFile(join(runDir, 'impact.shard-1.md'), 'utf8')).toBe(REPORT_SHARD_MD)
  })

  test('a shard with no entries gets no impact files', async () => {
    await runImpact(runDir)
    expect(await impactFiles(runDir)).toEqual([
      'impact.brief.md',
      'impact.json',
      'impact.md',
      'impact.shard-1.brief.md',
      'impact.shard-1.md',
    ])
  })

  test('the done log line carries the counts', async () => {
    await runImpact(runDir)
    const last = (await logEntries(runDir)).at(-1)
    expect(last).toEqual({
      stage: 'impact',
      status: 'done',
      symbols: 1,
      uses: 0,
      stores: 1,
      routes: 1,
      docs: 1,
      ts: expect.any(Number),
    })
  })

  test('a second run removes shard files the first left behind', async () => {
    await runImpact(runDir)
    await writeFile(join(runDir, 'impact.shard-3.md'), 'stale\n')
    await writeFile(join(runDir, 'impact.shard-3.brief.md'), 'stale\n')
    await runImpact(runDir)
    expect(await impactFiles(runDir)).toEqual([
      'impact.brief.md',
      'impact.json',
      'impact.md',
      'impact.shard-1.brief.md',
      'impact.shard-1.md',
    ])
  })

  test('magpie shard rewrites the per-shard files for the new split', async () => {
    await runImpact(runDir)
    const proc = Bun.spawn(['bun', CLI, 'shard', runDir, '--budget', '1'], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    expect(await proc.exited).toBe(0)
    // Budget 1 puts each file in its own shard, in diff order: notes.txt,
    // src/report.ts, src/routes.ts.
    expect(await impactFiles(runDir)).toEqual([
      'impact.brief.md',
      'impact.json',
      'impact.md',
      'impact.shard-2.brief.md',
      'impact.shard-2.md',
      'impact.shard-3.brief.md',
      'impact.shard-3.md',
    ])
    expect(await readFile(join(runDir, 'impact.shard-2.md'), 'utf8')).toBe(REPORT_SHARD_MD)
    expect(await readFile(join(runDir, 'impact.shard-3.md'), 'utf8')).toBe(ROUTES_MD)
  })
})

describe('runImpact failures', () => {
  test('a review root that is not a git repo logs skipped and exits 0', async () => {
    const notRepo = await tempDir('magpie-impact-norepo-')
    const dir = await makeRunDir(notRepo)
    expect(await runImpact(dir)).toBe(0)
    const last = (await logEntries(dir)).at(-1)
    expect(last?.stage).toBe('impact')
    expect(last?.status).toBe('skipped')
    expect(String(last?.error)).toContain('not a git repository')
    expect(await impactFiles(dir)).toEqual([])
  })

  test('a missing diff.patch logs skipped naming the file', async () => {
    const dir = await makeRunDir(repo)
    await rm(join(dir, 'diff.patch'))
    expect(await runImpact(dir)).toBe(0)
    const last = (await logEntries(dir)).at(-1)
    expect(last?.status).toBe('skipped')
    expect(String(last?.error)).toContain(join(dir, 'diff.patch'))
  })

  test('a missing run dir is a usage error', async () => {
    const parent = await tempDir('magpie-impact-missing-')
    expect(await runImpact(join(parent, 'no-such-run'))).toBe(2)
  })

  test('a directory that is not a magpie run is a usage error', async () => {
    expect(await runImpact(await tempDir('magpie-impact-empty-'))).toBe(2)
  })
})

describe('readImpactMap', () => {
  test('returns null when impact.json is absent', async () => {
    expect(await readImpactMap(await tempDir('magpie-impact-read-'))).toBeNull()
  })

  test('throws naming the file when impact.json is not a map', async () => {
    const dir = await tempDir('magpie-impact-read-')
    await writeFile(join(dir, 'impact.json'), '{}')
    await expect(readImpactMap(dir)).rejects.toThrow(join(dir, 'impact.json'))
  })
})

const PROGRESS_PANE = `<section class="progress-pane" data-role="progress-pane">
    <p class="now-doing">Five reviewers reading the diff in parallel.</p>
    <ol class="pipeline" style="--done-count: 2"><li class="step done" data-stage="setup"><span class="dot"></span><span class="name">setup</span><span class="hint">fetch PR and diff</span></li><li class="step done" data-stage="context"><span class="dot"></span><span class="name">context</span><span class="hint">index symbols</span></li><li class="step running" data-stage="specialists"><span class="dot"></span><span class="name">specialists</span><span class="hint">five reviewers in parallel</span></li><li class="step pending" data-stage="dedupe"><span class="dot"></span><span class="name">dedupe</span><span class="hint">merge overlaps</span></li><li class="step pending" data-stage="critic"><span class="dot"></span><span class="name">critic</span><span class="hint">keep the high-signal ones</span></li><li class="step pending" data-stage="peer-review"><span class="dot"></span><span class="name">peer-review</span><span class="hint">independent second opinion</span></li><li class="step pending" data-stage="report"><span class="dot"></span><span class="name">report</span><span class="hint">render this page</span></li><li class="step pending" data-stage="post"><span class="dot"></span><span class="name">post</span><span class="hint">comment on the PR</span></li></ol>
    <p class="specialists-line"><span class="count">0</span> findings <span class="sep">·</span> <span class="part">security <span class="count">0</span></span><span class="sep">·</span><span class="part">bugs <span class="count">0</span></span><span class="sep">·</span><span class="part">performance <span class="count">0</span></span><span class="sep">·</span><span class="part">code-smells <span class="count">0</span></span><span class="sep">·</span><span class="part">architecture <span class="count">0</span></span></p>
  </section>`

test('impact log entries change neither status nor the progress page', async () => {
  const dir = await tempDir('magpie-impact-status-')
  await writeFile(join(dir, 'target.json'), JSON.stringify({ mode: 'pr', root: dir }))
  await writeFile(
    join(dir, 'log.jsonl'),
    [
      { stage: 'setup', status: 'done' },
      { stage: 'context', status: 'done' },
      { stage: 'specialists', status: 'running' },
    ]
      .map((e) => `${JSON.stringify(e)}\n`)
      .join(''),
  )
  const expectedStatus: StatusResult = {
    lastCompleted: 'context',
    next: 'specialists',
    error: null,
  }

  expect(await runStatus(dir)).toEqual(expectedStatus)
  await runRender(dir, 'progress')
  const before = await readFile(join(dir, 'screen', 'progress.html'), 'utf8')
  expect(before).toContain(PROGRESS_PANE)

  await appendFile(
    join(dir, 'log.jsonl'),
    `${JSON.stringify({ stage: 'impact', status: 'done', symbols: 1, uses: 0, stores: 1, routes: 1, docs: 1, ts: 1 })}\n${JSON.stringify({ stage: 'impact', status: 'skipped', error: 'git grep exited 128', ts: 2 })}\n`,
  )

  expect(await runStatus(dir)).toEqual(expectedStatus)
  await runRender(dir, 'progress')
  expect(await readFile(join(dir, 'screen', 'progress-v2.html'), 'utf8')).toBe(before)
})
