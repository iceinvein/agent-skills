import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runStatus } from '../status-cmd.ts'

let runDir: string

beforeEach(async () => {
  runDir = await mkdtemp(join(tmpdir(), 'magpie-status-'))
})

afterEach(async () => {
  await rm(runDir, { recursive: true, force: true })
})

test('reports last completed stage', async () => {
  await writeFile(
    join(runDir, 'log.jsonl'),
    `${JSON.stringify({ stage: 'setup', status: 'done' })}\n${JSON.stringify({ stage: 'context', status: 'done' })}\n${JSON.stringify({ stage: 'specialists', status: 'running' })}\n`,
  )
  const result = await runStatus(runDir)
  expect(result.lastCompleted).toBe('context')
  expect(result.next).toBe('specialists')
})

test('empty log reports nothing completed', async () => {
  await writeFile(join(runDir, 'log.jsonl'), '')
  const result = await runStatus(runDir)
  expect(result.lastCompleted).toBeNull()
  expect(result.next).toBe('setup')
})

test('a skipped stage advances the resume pointer past it', async () => {
  // `context` has no work in the pipeline; SKILL.md tells the orchestrator to
  // log it as skipped. If `skipped` did not advance the pointer, a resume
  // would be sent back to a stage that has no step to run.
  await writeFile(
    join(runDir, 'log.jsonl'),
    `${JSON.stringify({ stage: 'setup', status: 'done' })}\n${JSON.stringify({ stage: 'context', status: 'skipped' })}\n`,
  )
  const result = await runStatus(runDir)
  expect(result.lastCompleted).toBe('context')
  expect(result.next).toBe('specialists')
})

test('error stage halts progression', async () => {
  await writeFile(
    join(runDir, 'log.jsonl'),
    `${JSON.stringify({ stage: 'setup', status: 'done' })}\n${JSON.stringify({ stage: 'context', status: 'error' })}\n`,
  )
  const result = await runStatus(runDir)
  expect(result.lastCompleted).toBe('setup')
  expect(result.error).toBe('context')
})

function logLines(entries: [string, string][]): string {
  return entries.map(([stage, status]) => `${JSON.stringify({ stage, status })}\n`).join('')
}

const throughPeerReview: [string, string][] = [
  ['setup', 'done'],
  ['context', 'done'],
  ['specialists', 'done'],
  ['dedupe', 'done'],
  ['critic', 'done'],
  ['peer-review', 'done'],
]

test('a local run after peer-review resumes at handoff', async () => {
  await writeFile(join(runDir, 'target.json'), JSON.stringify({ mode: 'local', root: runDir }))
  await writeFile(join(runDir, 'log.jsonl'), logLines(throughPeerReview))
  const result = await runStatus(runDir)
  expect(result.lastCompleted).toBe('peer-review')
  expect(result.next).toBe('handoff')
})

test('a local run with handoff done goes to cleanup', async () => {
  await writeFile(join(runDir, 'target.json'), JSON.stringify({ mode: 'local', root: runDir }))
  await writeFile(join(runDir, 'log.jsonl'), logLines([...throughPeerReview, ['handoff', 'done']]))
  const result = await runStatus(runDir)
  expect(result.lastCompleted).toBe('handoff')
  expect(result.next).toBe('cleanup')
})

test('a run without target.json after peer-review still resumes at report', async () => {
  await writeFile(join(runDir, 'log.jsonl'), logLines(throughPeerReview))
  const result = await runStatus(runDir)
  expect(result.next).toBe('report')
})
