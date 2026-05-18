import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_STAGE,
  KNOWN_STAGE_PRESETS,
  type PreviewResult,
  runPreview,
  type STAGE_PRESETS,
} from '../preview-cmd.ts'

let workDir: string

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'magpie-preview-test-'))
})

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true })
})

// Captures any opener invocations so we can assert without spawning a real OS
// open command in tests.
function withCapturedOpener(): { calls: string[]; factory: () => (path: string) => Promise<void> } {
  const calls: string[] = []
  return {
    calls,
    factory: () => async (path: string) => {
      calls.push(path)
    },
  }
}

test('renders both pages by default from the bundled fixture', async () => {
  const opener = withCapturedOpener()
  const result = await runPreview({
    page: 'both',
    stage: DEFAULT_STAGE,
    outDir: workDir,
    openerFactory: opener.factory,
  })
  expect(result.findingsHtml).toBe(join(workDir, 'findings.html'))
  expect(result.progressHtml).toBe(join(workDir, 'progress.html'))
  const findings = await readFile(result.findingsHtml as string, 'utf8')
  const progress = await readFile(result.progressHtml as string, 'utf8')
  expect(findings).toContain('PR #1337')
  expect(findings).toContain('feat/session-redis-and-prompts')
  // The fixture covers all four severities so the breakdown line should
  // include each one.
  expect(findings).toContain('blocker')
  expect(findings).toContain('high')
  expect(findings).toContain('medium')
  expect(findings).toContain('low')
  expect(progress).toContain('PR #1337')
  // Default stage is report-done so the connector should fill 7/7 segments
  // before the final post stage.
  expect(progress).toContain('--done-count: 7')
})

test('honors --page findings: progress is not rendered', async () => {
  const opener = withCapturedOpener()
  const result = await runPreview({
    page: 'findings',
    stage: DEFAULT_STAGE,
    outDir: workDir,
    openerFactory: opener.factory,
  })
  expect(result.findingsHtml).toBeDefined()
  expect(result.progressHtml).toBeUndefined()
})

test('honors --page progress: findings is not rendered', async () => {
  const opener = withCapturedOpener()
  const result = await runPreview({
    page: 'progress',
    stage: 'specialists-running',
    outDir: workDir,
    openerFactory: opener.factory,
  })
  expect(result.progressHtml).toBeDefined()
  expect(result.findingsHtml).toBeUndefined()
  const html = await readFile(result.progressHtml as string, 'utf8')
  expect(html).toContain('class="step running"')
})

test('--no-open suppresses the browser opener', async () => {
  const opener = withCapturedOpener()
  await runPreview({
    page: 'both',
    stage: DEFAULT_STAGE,
    outDir: workDir,
    openInBrowser: false,
    openerFactory: opener.factory,
  })
  expect(opener.calls).toEqual([])
})

test('opener is called with the findings path when both pages are rendered', async () => {
  const opener = withCapturedOpener()
  const result = await runPreview({
    page: 'both',
    stage: DEFAULT_STAGE,
    outDir: workDir,
    openInBrowser: true,
    openerFactory: opener.factory,
  })
  expect(opener.calls).toEqual([result.findingsHtml as string])
  expect(result.opened).toBe(result.findingsHtml)
})

test('dry-run returns the planned paths without writing files', async () => {
  const opener = withCapturedOpener()
  const result = await runPreview({
    page: 'both',
    stage: DEFAULT_STAGE,
    outDir: workDir,
    dryRun: true,
    openerFactory: opener.factory,
  })
  expect(result.dryRun).toBe(true)
  expect(result.findingsHtml).toBe(join(workDir, 'findings.html'))
  expect(opener.calls).toEqual([])
  // Nothing should have been created in workDir.
  let createdAnyway = false
  try {
    await readFile(join(workDir, 'findings.html'), 'utf8')
    createdAnyway = true
  } catch {
    // expected
  }
  expect(createdAnyway).toBe(false)
})

test('every stage preset is renderable end-to-end', async () => {
  for (const stage of KNOWN_STAGE_PRESETS) {
    const stageDir = join(workDir, stage)
    const opener = withCapturedOpener()
    const result: PreviewResult = await runPreview({
      page: 'progress',
      stage,
      outDir: stageDir,
      openInBrowser: false,
      openerFactory: opener.factory,
    })
    const html = await readFile(result.progressHtml as string, 'utf8')
    expect(html).toContain('class="pipeline"')
  }
})

test('--done-count in the progress page reflects the chosen preset', async () => {
  const cases: Array<{ stage: keyof typeof STAGE_PRESETS; expectedDone: number }> = [
    { stage: 'fresh', expectedDone: 0 },
    { stage: 'setup-done', expectedDone: 1 },
    { stage: 'specialists-done', expectedDone: 3 },
    { stage: 'critic-done', expectedDone: 5 },
    { stage: 'report-done', expectedDone: 7 },
    { stage: 'post-done', expectedDone: 8 },
  ]
  for (const { stage, expectedDone } of cases) {
    const stageDir = join(workDir, stage)
    await runPreview({
      page: 'progress',
      stage,
      outDir: stageDir,
      openInBrowser: false,
    })
    const html = await readFile(join(stageDir, 'progress.html'), 'utf8')
    expect(html).toContain(`--done-count: ${expectedDone}`)
  }
})

test('peer-review-error preset surfaces the error step in the rendered HTML', async () => {
  await runPreview({
    page: 'progress',
    stage: 'peer-review-error',
    outDir: workDir,
    openInBrowser: false,
  })
  const html = await readFile(join(workDir, 'progress.html'), 'utf8')
  expect(html).toContain('class="step error"')
  expect(html).toContain('data-stage="peer-review"')
})

test('mixed post-status in the fixture surfaces both posted and failed badges', async () => {
  await runPreview({
    page: 'findings',
    stage: DEFAULT_STAGE,
    outDir: workDir,
    openInBrowser: false,
  })
  const html = await readFile(join(workDir, 'findings.html'), 'utf8')
  expect(html).toContain('class="status-chip posted"')
  expect(html).toContain('class="status-chip failed"')
  // The fixture's failed entry includes a 422 message; make sure it survives.
  expect(html).toContain('422')
})

test('bundled fixture covers all five focus domains', async () => {
  await runPreview({
    page: 'findings',
    stage: DEFAULT_STAGE,
    outDir: workDir,
    openInBrowser: false,
  })
  const html = await readFile(join(workDir, 'findings.html'), 'utf8')
  for (const domain of ['security', 'bugs', 'performance', 'code-smells', 'architecture']) {
    expect(html).toContain(`data-domain="${domain}"`)
  }
})
