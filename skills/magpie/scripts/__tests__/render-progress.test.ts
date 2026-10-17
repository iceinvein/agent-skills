import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runRender } from '../render-cmd.ts'
import { renderProgressHtml } from '../render-progress.ts'

test('renderProgressHtml shows all stages with status classes and PR header', () => {
  const html = renderProgressHtml({
    prNumber: 1234,
    headSha: 'deadbeef00112233',
    branch: 'feature-x',
    stages: {
      setup: 'done',
      context: 'done',
      specialists: 'running',
      dedupe: 'pending',
      critic: 'pending',
      'peer-review': 'pending',
      report: 'pending',
      post: 'pending',
    },
    specialistCounts: { security: 2, bugs: 0 },
  })
  expect(html).toContain('PR #1234')
  expect(html).toContain('feature-x')
  expect(html).toContain('deadbeef0011')
  // Pipeline timeline structure
  expect(html).toContain('class="step done"')
  expect(html).toContain('data-stage="setup"')
  expect(html).toContain('class="step running"')
  expect(html).toContain('data-stage="specialists"')
  // Specialist line: total count + per-focus inline
  expect(html).toContain('specialists-line')
  expect(html).toContain('security')
  expect(html).toContain('<span class="count">2</span>')
})

test('renderProgressHtml renders empty specialists-line before any focus reports', () => {
  const html = renderProgressHtml({
    prNumber: 1,
    headSha: 'abcd1234',
    branch: 'main',
    stages: {
      setup: 'done',
      context: 'pending',
      specialists: 'pending',
      dedupe: 'pending',
      critic: 'pending',
      'peer-review': 'pending',
      report: 'pending',
      post: 'pending',
    },
    specialistCounts: {},
  })
  expect(html).toContain('awaiting specialist output')
})

test('pipeline carries a --done-count style for the filling connector line', () => {
  const html = renderProgressHtml({
    prNumber: 1,
    headSha: 'abcd1234',
    branch: 'main',
    stages: {
      setup: 'done',
      context: 'done',
      specialists: 'done',
      dedupe: 'running',
      critic: 'pending',
      'peer-review': 'pending',
      report: 'pending',
      post: 'pending',
    },
    specialistCounts: {},
  })
  // CSS uses --done-count / 7 to compute the connector fill width.
  expect(html).toContain('--done-count: 3')
})

test('each pipeline stage exposes a short sublabel so first-timers can learn what it does', () => {
  const html = renderProgressHtml({
    prNumber: 1,
    headSha: 'abcd1234',
    branch: 'main',
    stages: {
      setup: 'done',
      context: 'pending',
      specialists: 'pending',
      dedupe: 'pending',
      critic: 'pending',
      'peer-review': 'pending',
      report: 'pending',
      post: 'pending',
    },
    specialistCounts: {},
  })
  expect(html).toContain('class="hint"')
  expect(html).toContain('six reviewers in parallel')
  expect(html).toContain('independent second opinion')
})

test('renderProgressHtml includes the archived banner element', () => {
  const html = renderProgressHtml({
    prNumber: 1,
    headSha: 'abcd1234',
    branch: 'main',
    stages: {
      setup: 'done',
      context: 'pending',
      specialists: 'pending',
      dedupe: 'pending',
      critic: 'pending',
      'peer-review': 'pending',
      report: 'pending',
      post: 'pending',
    },
    specialistCounts: {},
  })
  expect(html).toContain('archived-banner')
})

test('emits the shared pr-header chrome', () => {
  const html = renderProgressHtml({
    prNumber: 1,
    headSha: 'abc123def456789012345678',
    branch: 'feat',
    stages: {
      setup: 'running',
      context: 'pending',
      specialists: 'pending',
      dedupe: 'pending',
      critic: 'pending',
      'peer-review': 'pending',
      report: 'pending',
      post: 'pending',
    },
    specialistCounts: {},
  })
  expect(html).toContain('class="pr-header"')
  expect(html).toContain('data-page="progress"')
  expect(html).toContain('class="segmented"')
})

test('progress-pane block replaces diff-pane on the progress page', () => {
  const html = renderProgressHtml({
    prNumber: 1,
    headSha: 'abc123def456789012345678',
    branch: 'feat',
    stages: {
      setup: 'done',
      context: 'running',
      specialists: 'pending',
      dedupe: 'pending',
      critic: 'pending',
      'peer-review': 'pending',
      report: 'pending',
      post: 'pending',
    },
    specialistCounts: { security: 0 },
  })
  expect(html).toContain('data-role="progress-pane"')
  expect(html).toContain('Reading the PR to brief the reviewers')
})

test('progress names the shard count while specialists run', () => {
  const html = renderProgressHtml({
    prNumber: 7,
    headSha: 'abc123abc123',
    branch: 'feature-x',
    stages: {
      setup: 'done',
      context: 'done',
      specialists: 'running',
      dedupe: 'pending',
      critic: 'pending',
      'peer-review': 'pending',
      report: 'pending',
      post: 'pending',
    },
    specialistCounts: {},
    shardCount: 6,
  })
  expect(html).toContain('Six reviewers across 6 shards')
})

test('progress keeps the single-shard wording when there is one shard', () => {
  const html = renderProgressHtml({
    prNumber: 7,
    headSha: 'abc123abc123',
    branch: 'feature-x',
    stages: {
      setup: 'done',
      context: 'done',
      specialists: 'running',
      dedupe: 'pending',
      critic: 'pending',
      'peer-review': 'pending',
      report: 'pending',
      post: 'pending',
    },
    specialistCounts: {},
    shardCount: 1,
  })
  expect(html).toContain('Six reviewers reading the diff in parallel')
})

test('progress shows a contracts count once a contracts specialist reports', async () => {
  const runDir = await mkdtemp(join(tmpdir(), 'magpie-progress-'))
  try {
    await mkdir(join(runDir, 'screen'), { recursive: true })
    await writeFile(
      join(runDir, 'pr.json'),
      JSON.stringify({ number: 7, headRefName: 'feature-x', headRefOid: 'abc123abc123' }),
    )
    await writeFile(
      join(runDir, 'log.jsonl'),
      [
        JSON.stringify({ stage: 'specialists', status: 'running' }),
        JSON.stringify({
          stage: 'specialist',
          focus: 'contracts',
          shard: 1,
          status: 'done',
          findings: 3,
        }),
      ].join('\n'),
    )
    expect(await runRender(runDir, 'progress')).toBe(0)
    const html = await readFile(join(runDir, 'screen', 'progress.html'), 'utf8')
    expect(html).toContain('contracts <span class="count">3</span>')
  } finally {
    await rm(runDir, { recursive: true, force: true })
  }
})
