import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  describePreviousPosted,
  type PreviousFinding,
  readPreviousFindings,
} from '../previous-findings.ts'

let root: string
let prevRun: string
let worktree: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'magpie-previous-'))
  prevRun = join(root, 'pr-7-100')
  worktree = join(root, 'worktree')
  await mkdir(join(prevRun, 'state'), { recursive: true })
  await mkdir(join(worktree, 'src'), { recursive: true })
  await writeFile(
    join(worktree, 'src', 'upload.ts'),
    'export function upload() {\n  try {\n    send()\n  } catch {}\n}\n',
  )
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function finding(
  id: string,
  file: string,
  line: number | null,
  evidence: string | undefined,
): Record<string, unknown> {
  return {
    id,
    file,
    line,
    ...(evidence !== undefined ? { evidence } : {}),
    severity: 'high',
    risk: { impact: 'high', likelihood: 'likely', confidence: 'high', action: 'should-fix' },
    title: `title of ${id}`,
    description: 'Observation: x',
    domain: 'bugs',
  }
}

async function seedFinal(findings: Record<string, unknown>[]): Promise<void> {
  await writeFile(join(prevRun, 'findings.final.json'), JSON.stringify(findings))
}

test('a previous run with no findings.final.json yields null', async () => {
  expect(await readPreviousFindings({ runDir: prevRun, runId: 'pr-7-100', worktree })).toBeNull()
})

test('an aborted previous run still passes on the dismissals it carried', async () => {
  const carried: PreviousFinding = {
    id: 'perf-3',
    fromRunId: 'pr-7-50',
    file: 'src/cache.ts',
    line: 9,
    title: 'Cache never evicts',
    domain: 'performance',
    label: 'dismissed',
    reason: 'not-worth-it',
  }
  await writeFile(
    join(prevRun, 'previous-findings.json'),
    JSON.stringify({ previousRunId: 'pr-7-50', findings: [carried] }),
  )
  const result = await readPreviousFindings({ runDir: prevRun, runId: 'pr-7-100', worktree })
  expect(result).toEqual({ previousRunId: 'pr-7-100', findings: [carried] })
})

test('a posted finding whose evidence is still in the file reads as anchor unchanged', async () => {
  await seedFinal([finding('bugs-1', 'src/upload.ts', 4, '  } catch {}')])
  await writeFile(join(prevRun, 'post-status.json'), JSON.stringify({ 'bugs-1': 'posted' }))
  const result = await readPreviousFindings({ runDir: prevRun, runId: 'pr-7-100', worktree })
  expect(result?.findings).toEqual([
    {
      id: 'bugs-1',
      fromRunId: 'pr-7-100',
      file: 'src/upload.ts',
      line: 4,
      title: 'title of bugs-1',
      domain: 'bugs',
      label: 'posted',
      anchor: 'unchanged',
    },
  ])
})

test('a posted finding whose evidence moved within the file still reads as unchanged', async () => {
  await seedFinal([finding('bugs-1', 'src/upload.ts', 40, '    send()')])
  await writeFile(join(prevRun, 'post-status.json'), JSON.stringify({ 'bugs-1': 'posted' }))
  const result = await readPreviousFindings({ runDir: prevRun, runId: 'pr-7-100', worktree })
  expect(result?.findings[0]).toMatchObject({ anchor: 'unchanged' })
})

test('a posted finding whose evidence is gone reads as anchor changed', async () => {
  await seedFinal([finding('bugs-1', 'src/upload.ts', 4, '  } catch (e) { log(e) }')])
  await writeFile(join(prevRun, 'post-status.json'), JSON.stringify({ 'bugs-1': 'posted' }))
  const result = await readPreviousFindings({ runDir: prevRun, runId: 'pr-7-100', worktree })
  expect(result?.findings[0]).toMatchObject({ anchor: 'changed' })
})

test('a posted finding on a file that no longer exists reads as anchor changed', async () => {
  await seedFinal([finding('bugs-1', 'src/gone.ts', 4, 'x')])
  await writeFile(join(prevRun, 'post-status.json'), JSON.stringify({ 'bugs-1': 'posted' }))
  const result = await readPreviousFindings({ runDir: prevRun, runId: 'pr-7-100', worktree })
  expect(result?.findings[0]).toMatchObject({ anchor: 'changed' })
})

test('a posted finding with no line reads as unanchored', async () => {
  await seedFinal([finding('tests-1', 'src/upload.ts', null, undefined)])
  await writeFile(join(prevRun, 'post-status.json'), JSON.stringify({ 'tests-1': 'posted' }))
  const result = await readPreviousFindings({ runDir: prevRun, runId: 'pr-7-100', worktree })
  expect(result?.findings[0]).toMatchObject({ anchor: 'unanchored' })
})

test('a dismissed finding carries its reason, and ignored findings are left out', async () => {
  await seedFinal([
    finding('bugs-1', 'src/upload.ts', 4, '  } catch {}'),
    finding('bugs-2', 'src/upload.ts', 3, '    send()'),
  ])
  await writeFile(
    join(prevRun, 'state', 'events'),
    `${JSON.stringify({ type: 'dismiss', findingId: 'bugs-1', reason: 'style', timestamp: 1 })}\n`,
  )
  const result = await readPreviousFindings({ runDir: prevRun, runId: 'pr-7-100', worktree })
  expect(result?.findings).toEqual([
    {
      id: 'bugs-1',
      fromRunId: 'pr-7-100',
      file: 'src/upload.ts',
      line: 4,
      title: 'title of bugs-1',
      domain: 'bugs',
      label: 'dismissed',
      reason: 'style',
    },
  ])
})

test('labels.json on an archived run is read in place of re-folding the events', async () => {
  await seedFinal([finding('bugs-1', 'src/upload.ts', 4, '  } catch {}')])
  await writeFile(
    join(prevRun, 'labels.json'),
    JSON.stringify([{ id: 'bugs-1', label: 'dismissed', reason: 'wrong' }]),
  )
  const result = await readPreviousFindings({ runDir: prevRun, runId: 'pr-7-100', worktree })
  expect(result?.findings[0]).toMatchObject({ label: 'dismissed', reason: 'wrong' })
})

test('dismissals the previous run carried from earlier runs are carried again', async () => {
  await seedFinal([])
  await writeFile(
    join(prevRun, 'previous-findings.json'),
    JSON.stringify({
      previousRunId: 'pr-7-50',
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
          id: 'bugs-9',
          fromRunId: 'pr-7-50',
          file: 'src/a.ts',
          line: 1,
          title: 'posted long ago',
          domain: 'bugs',
          label: 'posted',
          anchor: 'unchanged',
        },
      ],
    }),
  )
  const result = await readPreviousFindings({ runDir: prevRun, runId: 'pr-7-100', worktree })
  expect(result).toEqual({
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
    ],
  })
})

function posted(id: string, anchor: 'unchanged' | 'changed' | 'unanchored'): PreviousFinding {
  return {
    id,
    fromRunId: 'pr-7-100',
    file: 'src/a.ts',
    line: 1,
    title: id,
    domain: 'bugs',
    label: 'posted',
    anchor,
  }
}

test('the previous-run line counts posted findings by whether their code changed', () => {
  const line = describePreviousPosted({
    previousRunId: 'pr-7-100',
    findings: [posted('a', 'changed'), posted('b', 'changed'), posted('c', 'unchanged')],
  })
  expect(line).toBe('Last review: 3 posted · 2 on changed code · 1 on unchanged code')
})

test('the previous-run line names unanchored posts only when there are some', () => {
  const line = describePreviousPosted({
    previousRunId: 'pr-7-100',
    findings: [posted('a', 'unanchored'), posted('b', 'unchanged')],
  })
  expect(line).toBe(
    'Last review: 2 posted · 0 on changed code · 1 on unchanged code · 1 not anchored to a line',
  )
})

test('the previous-run line is null when nothing was posted last review', () => {
  const line = describePreviousPosted({
    previousRunId: 'pr-7-100',
    findings: [
      {
        id: 'x',
        fromRunId: 'pr-7-100',
        file: 'src/a.ts',
        line: 1,
        title: 'x',
        domain: 'bugs',
        label: 'dismissed',
        reason: 'wrong',
      },
    ],
  })
  expect(line).toBeNull()
})

test('a carried dismissal with no file or title fails, naming the file', async () => {
  await seedFinal([])
  await writeFile(
    join(prevRun, 'previous-findings.json'),
    JSON.stringify({
      previousRunId: 'pr-7-50',
      findings: [{ id: 'perf-3', fromRunId: 'pr-7-50', label: 'dismissed', reason: 'wrong' }],
    }),
  )
  await expect(
    readPreviousFindings({ runDir: prevRun, runId: 'pr-7-100', worktree }),
  ).rejects.toThrow('previous-findings.json')
})
