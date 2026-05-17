import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
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
