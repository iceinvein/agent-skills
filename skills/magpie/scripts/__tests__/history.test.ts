import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readHistory, renderAlreadyRaised, renderHistory } from '../history.ts'
import type { PrActivity } from '../pr-activity.ts'
import type { PreviousFindings } from '../previous-findings.ts'

const ACTIVITY: PrActivity = {
  checks: [
    { name: 'build', conclusion: 'FAILURE', url: 'https://ci.example/1' },
    { name: 'lint', conclusion: 'SUCCESS', url: null },
    { name: 'deploy', conclusion: 'TIMED_OUT', url: null },
  ],
  threads: [
    {
      file: 'src/upload.ts',
      line: 42,
      resolved: false,
      outdated: false,
      author: 'dave',
      body: 'This swallows\n\nthe timeout error.',
      replies: 2,
      magpie: false,
    },
    {
      file: 'src/cache.ts',
      line: 9,
      resolved: false,
      outdated: true,
      author: 'octocat',
      body: '### High\nCache never evicts\n<!-- magpie:finding id=perf-1 hash=abc -->',
      replies: 0,
      magpie: true,
    },
    {
      file: 'src/done.ts',
      line: 1,
      resolved: true,
      outdated: false,
      author: 'erin',
      body: 'Fixed already.',
      replies: 1,
      magpie: false,
    },
  ],
  comments: [{ author: 'alice', body: 'Does this retry past three attempts?', magpie: false }],
}

const PREVIOUS: PreviousFindings = {
  previousRunId: 'pr-7-100',
  findings: [
    {
      id: 'perf-3',
      fromRunId: 'pr-7-50',
      file: 'src/cache.ts',
      line: 9,
      title: 'Cache never evicts',
      domain: 'performance',
      label: 'dismissed',
      reason: 'not-worth-it',
    },
    {
      id: 'bugs-1',
      fromRunId: 'pr-7-100',
      file: 'src/upload.ts',
      line: 4,
      title: 'Swallowed error',
      domain: 'bugs',
      label: 'posted',
      anchor: 'unchanged',
    },
  ],
}

test('already-raised lists open threads, comments and dismissals, skipping resolved threads', () => {
  expect(renderAlreadyRaised({ activity: ACTIVITY, previous: PREVIOUS })).toBe(
    [
      'Open review threads:',
      '- src/upload.ts:42 (dave, 2 replies): This swallows the timeout error.',
      '- src/cache.ts:9 (magpie, earlier run) [outdated]: ### High Cache never evicts',
      '',
      'PR comments:',
      '- alice: Does this retry past three attempts?',
      '',
      'Dismissed by the reviewer in an earlier magpie run:',
      '- src/cache.ts:9 [not-worth-it]: Cache never evicts',
    ].join('\n'),
  )
})

test('already-raised is (none) when nothing is on the PR and nothing was dismissed', () => {
  expect(renderAlreadyRaised({ activity: null, previous: null })).toBe('(none)')
})

test('a long comment is cut to 280 characters with an ellipsis', () => {
  const long = 'a'.repeat(400)
  const out = renderAlreadyRaised({
    activity: { checks: [], threads: [], comments: [{ author: 'bot', body: long, magpie: false }] },
    previous: null,
  })
  expect(out).toBe(`PR comments:\n- bot: ${'a'.repeat(280)}…`)
})

test('history adds failing checks and the files changed since the last review', () => {
  const out = renderHistory({
    activity: ACTIVITY,
    previous: PREVIOUS,
    incremental: { previousSha: 'abc1234def', changedSincePrevious: ['src/upload.ts'] },
  })
  expect(out).toBe(
    [
      '## Already on this PR',
      '',
      'The threads, comments and dismissals below were raised before this review. Do not report a finding that repeats one of them: the critic drops repeats. Report it again only when you have something material it lacks, and say what that is.',
      '',
      'Open review threads:',
      '- src/upload.ts:42 (dave, 2 replies): This swallows the timeout error.',
      '- src/cache.ts:9 (magpie, earlier run) [outdated]: ### High Cache never evicts',
      '',
      'PR comments:',
      '- alice: Does this retry past three attempts?',
      '',
      'Dismissed by the reviewer in an earlier magpie run:',
      '- src/cache.ts:9 [not-worth-it]: Cache never evicts',
      '',
      'Leads, not repeats: a finding that explains one of these is wanted.',
      '',
      'Failing CI checks (a lead to investigate, not a finding in itself):',
      '- build: FAILURE (https://ci.example/1)',
      '- deploy: TIMED_OUT',
      '',
      'Files changed since the last review at abc1234 (the whole diff is still your scope):',
      '- src/upload.ts',
    ].join('\n'),
  )
})

test('history is empty when the run has no activity, no previous run and no incremental', () => {
  expect(renderHistory({ activity: null, previous: null, incremental: null })).toBe('')
})

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'magpie-history-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

test('readHistory reads the three sidecars from a run dir', async () => {
  await writeFile(join(dir, 'pr-activity.json'), JSON.stringify(ACTIVITY))
  await writeFile(join(dir, 'previous-findings.json'), JSON.stringify(PREVIOUS))
  await writeFile(
    join(dir, 'incremental.json'),
    JSON.stringify({
      previousRunId: 'pr-7-100',
      previousSha: 'abc1234def',
      currentSha: 'fff',
      sameSha: false,
      changedSincePrevious: ['src/upload.ts'],
    }),
  )
  const history = await readHistory(dir)
  expect(history.activity?.threads).toHaveLength(3)
  expect(history.previous?.previousRunId).toBe('pr-7-100')
  expect(history.incremental).toEqual({
    previousSha: 'abc1234def',
    changedSincePrevious: ['src/upload.ts'],
  })
})

test('readHistory reads a run with none of the sidecars as empty', async () => {
  expect(await readHistory(dir)).toEqual({ activity: null, previous: null, incremental: null })
})

test('readHistory fails on a sidecar that does not parse, naming it', async () => {
  await writeFile(join(dir, 'pr-activity.json'), '{not json')
  await expect(readHistory(dir)).rejects.toThrow('pr-activity.json')
})

test('history with only leads carries the leads heading and no repeats preamble', () => {
  const out = renderHistory({
    activity: {
      checks: [{ name: 'build', conclusion: 'FAILURE', url: null }],
      threads: [],
      comments: [],
    },
    previous: null,
    incremental: null,
  })
  expect(out).toBe(
    [
      '## Already on this PR',
      '',
      'Leads, not repeats: a finding that explains one of these is wanted.',
      '',
      'Failing CI checks (a lead to investigate, not a finding in itself):',
      '- build: FAILURE',
    ].join('\n'),
  )
})
