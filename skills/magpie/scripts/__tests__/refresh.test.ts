import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { refreshFindings } from '../refresh.ts'

let runDir: string

beforeEach(async () => {
  runDir = await mkdtemp(join(tmpdir(), 'magpie-refresh-'))
  await mkdir(join(runDir, 'screen'), { recursive: true })
})

afterEach(async () => {
  await rm(runDir, { recursive: true, force: true })
})

const sampleFinding = {
  id: 'a',
  file: 'src/x.ts',
  line: 1,
  severity: 'high',
  risk: { impact: 'high', likelihood: 'likely', confidence: 'high', action: 'must-fix' },
  title: 'tsst',
  description: 'd',
  domain: 'bugs',
}

test('refreshFindings no-ops when findings.final.json is absent', async () => {
  const result = await refreshFindings(runDir)
  expect(result).toEqual({ refreshed: false, pruned: 0, reason: 'no-findings-json' })
  // No file should be created.
  const entries = await readdir(join(runDir, 'screen'))
  expect(entries).toEqual([])
})

test('refreshFindings reports malformed-findings-json when content is not an array', async () => {
  await writeFile(join(runDir, 'findings.final.json'), JSON.stringify({ not: 'an array' }))
  const result = await refreshFindings(runDir)
  expect(result.refreshed).toBe(false)
  expect(result.reason).toBe('malformed-findings-json')
})

test('refreshFindings writes findings.html and prunes any older findings*.html', async () => {
  await writeFile(join(runDir, 'findings.final.json'), JSON.stringify([sampleFinding]))
  // Pre-existing stale files we expect to be pruned.
  await writeFile(join(runDir, 'screen', 'findings.html'), '<html>OLD</html>')
  await writeFile(join(runDir, 'screen', 'findings-v2.html'), '<html>OLD2</html>')
  await writeFile(join(runDir, 'screen', 'findings-v3.html'), '<html>OLD3</html>')
  // A non-findings file must survive.
  await writeFile(join(runDir, 'screen', 'progress.html'), '<html>progress</html>')

  const result = await refreshFindings(runDir)
  expect(result.refreshed).toBe(true)
  expect(result.pruned).toBe(3) // findings.html + 2 versioned siblings

  const entries = await readdir(join(runDir, 'screen'))
  expect(entries.sort()).toEqual(['findings.html', 'progress.html'])

  const fresh = await readFile(join(runDir, 'screen', 'findings.html'), 'utf8')
  // The new file is rendered, not the stale OLD content.
  expect(fresh).not.toContain('OLD')
  // Contains the new interactivity surface (segmented tabs, data-run-id).
  expect(fresh).toContain('data-action="set-view"')
  expect(fresh).toMatch(/data-run-id="[^"]+"/)
  // And the rendered finding itself.
  expect(fresh).toContain('tsst')
})

test('refreshFindings creates screen/ when missing', async () => {
  // Remove the screen dir made by beforeEach.
  await rm(join(runDir, 'screen'), { recursive: true })
  await writeFile(join(runDir, 'findings.final.json'), JSON.stringify([sampleFinding]))
  const result = await refreshFindings(runDir)
  expect(result.refreshed).toBe(true)
  const fresh = await readFile(join(runDir, 'screen', 'findings.html'), 'utf8')
  expect(fresh).toContain('tsst')
})

test('refreshFindings sets data-run-id from the run directory basename', async () => {
  await writeFile(join(runDir, 'findings.final.json'), JSON.stringify([sampleFinding]))
  await refreshFindings(runDir)
  const fresh = await readFile(join(runDir, 'screen', 'findings.html'), 'utf8')
  const expectedId = runDir.split('/').pop()
  expect(fresh).toContain(`data-run-id="${expectedId}"`)
})
