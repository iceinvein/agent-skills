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

test('error stage halts progression', async () => {
  await writeFile(
    join(runDir, 'log.jsonl'),
    `${JSON.stringify({ stage: 'setup', status: 'done' })}\n${JSON.stringify({ stage: 'context', status: 'error' })}\n`,
  )
  const result = await runStatus(runDir)
  expect(result.lastCompleted).toBe('setup')
  expect(result.error).toBe('context')
})
