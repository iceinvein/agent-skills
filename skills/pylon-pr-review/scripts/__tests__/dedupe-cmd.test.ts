import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runDedupe } from '../dedupe-cmd.ts'
import type { ReviewFinding } from '../types.ts'

let runDir: string

beforeEach(async () => {
  runDir = await mkdtemp(join(tmpdir(), 'prskill-dedupe-'))
  await mkdir(join(runDir, 'findings'), { recursive: true })
})

afterEach(async () => {
  await rm(runDir, { recursive: true, force: true })
})

function f(id: string, file: string, line: number, title: string, domain: string): ReviewFinding {
  return {
    id,
    file,
    line,
    severity: 'medium',
    risk: { impact: 'medium', likelihood: 'possible', confidence: 'medium', action: 'should-fix' },
    title,
    description: 'd',
    domain,
  }
}

test('runDedupe reads focus files, writes deduped output', async () => {
  await writeFile(
    join(runDir, 'findings', 'bugs.json'),
    JSON.stringify([f('1', 'a.ts', 10, 'null deref happens here', 'bugs')]),
  )
  await writeFile(
    join(runDir, 'findings', 'security.json'),
    JSON.stringify([f('2', 'a.ts', 10, 'null deref happens here', 'security')]),
  )
  const exit = await runDedupe(runDir)
  expect(exit).toBe(0)
  const out = JSON.parse(await readFile(join(runDir, 'findings.deduped.json'), 'utf8'))
  expect(out).toHaveLength(1)
  expect(out[0]?.description).toContain('Also flagged by')
})

test('runDedupe tolerates missing focus files', async () => {
  await writeFile(
    join(runDir, 'findings', 'bugs.json'),
    JSON.stringify([f('1', 'a.ts', 10, 'null deref', 'bugs')]),
  )
  const exit = await runDedupe(runDir)
  expect(exit).toBe(0)
  const out = JSON.parse(await readFile(join(runDir, 'findings.deduped.json'), 'utf8'))
  expect(out).toHaveLength(1)
})

test('runDedupe with malformed focus file logs and continues', async () => {
  await writeFile(join(runDir, 'findings', 'bugs.json'), 'not json')
  await writeFile(
    join(runDir, 'findings', 'security.json'),
    JSON.stringify([f('1', 'a.ts', 10, 'something', 'security')]),
  )
  const exit = await runDedupe(runDir)
  expect(exit).toBe(0)
  const out = JSON.parse(await readFile(join(runDir, 'findings.deduped.json'), 'utf8'))
  expect(out).toHaveLength(1)
  const log = await readFile(join(runDir, 'log.jsonl'), 'utf8')
  expect(log).toContain('"stage":"dedupe"')
  expect(log).toContain('parse-error')
})

test('runDedupe with no findings files writes empty array', async () => {
  const exit = await runDedupe(runDir)
  expect(exit).toBe(0)
  const out = JSON.parse(await readFile(join(runDir, 'findings.deduped.json'), 'utf8'))
  expect(out).toHaveLength(0)
})
