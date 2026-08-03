import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PostStatusMap } from './render-findings.ts'
import { renderFindingsToDisk } from './render-findings.ts'
import type { RenderProgressInput, StageId, StageStatus } from './render-progress.ts'
import { renderProgressToDisk } from './render-progress.ts'
import { type PrBrief, parseBrief, parseFinding } from './types.ts'

export type PreviewPage = 'findings' | 'progress' | 'both'

/** Stage presets. Each one is a complete snapshot of what the pipeline page
 * should look like at that point in the run. Keeping them as literal data
 * (instead of synthesizing from a log file) lets a designer iterate on the
 * progress UI without simulating events. */
export const STAGE_PRESETS = {
  fresh: {
    stages: pending(),
    counts: {},
  },
  'setup-running': {
    stages: { ...pending(), setup: 'running' },
    counts: {},
  },
  'setup-done': {
    stages: { ...pending(), setup: 'done', context: 'running' },
    counts: {},
  },
  'context-skipped': {
    stages: { ...pending(), setup: 'done', context: 'skipped', specialists: 'running' },
    counts: { security: 0, bugs: 1 },
  },
  'specialists-running': {
    // Partial counts coming in while the specialists are mid-flight.
    stages: {
      ...pending(),
      setup: 'done',
      context: 'done',
      specialists: 'running',
    },
    counts: { security: 1, bugs: 3, performance: 2, 'code-smells': 0, architecture: 0 },
  },
  'specialists-done': {
    stages: {
      ...pending(),
      setup: 'done',
      context: 'done',
      specialists: 'done',
      dedupe: 'running',
    },
    counts: { security: 1, bugs: 4, performance: 2, 'code-smells': 5, architecture: 3 },
  },
  'dedupe-done': {
    stages: {
      ...pending(),
      setup: 'done',
      context: 'done',
      specialists: 'done',
      dedupe: 'done',
      critic: 'running',
    },
    counts: { security: 1, bugs: 3, performance: 2, 'code-smells': 4, architecture: 2 },
  },
  'critic-done': {
    stages: {
      ...pending(),
      setup: 'done',
      context: 'done',
      specialists: 'done',
      dedupe: 'done',
      critic: 'done',
      'peer-review': 'running',
    },
    counts: { security: 1, bugs: 2, performance: 1, 'code-smells': 3, architecture: 2 },
  },
  'peer-review-error': {
    stages: {
      ...pending(),
      setup: 'done',
      context: 'done',
      specialists: 'done',
      dedupe: 'done',
      critic: 'done',
      'peer-review': 'error',
    },
    counts: { security: 1, bugs: 2, performance: 1, 'code-smells': 3, architecture: 2 },
  },
  'report-done': {
    // The default: what a reviewer sees when they open the page after the
    // pipeline finishes but before they post anything.
    stages: {
      ...pending(),
      setup: 'done',
      context: 'done',
      specialists: 'done',
      dedupe: 'done',
      critic: 'done',
      'peer-review': 'done',
      report: 'done',
    },
    counts: { security: 1, bugs: 2, performance: 2, 'code-smells': 2, architecture: 1 },
  },
  'post-done': {
    stages: {
      ...pending(),
      setup: 'done',
      context: 'done',
      specialists: 'done',
      dedupe: 'done',
      critic: 'done',
      'peer-review': 'done',
      report: 'done',
      post: 'done',
    },
    counts: { security: 1, bugs: 2, performance: 2, 'code-smells': 2, architecture: 1 },
  },
} as const

function pending(): Record<StageId, StageStatus> {
  return {
    setup: 'pending',
    context: 'pending',
    specialists: 'pending',
    dedupe: 'pending',
    critic: 'pending',
    'peer-review': 'pending',
    report: 'pending',
    post: 'pending',
  }
}

export type StagePreset = keyof typeof STAGE_PRESETS

export const DEFAULT_STAGE: StagePreset = 'report-done'

export type PreviewOptions = {
  page: PreviewPage
  stage: StagePreset
  /** Fixture directory; defaults to the bundled example-pr. */
  fixtureDir?: string
  /** Output directory; defaults to a timestamped path under ~/.magpie/. */
  outDir?: string
  /** When false, skip the OS `open` call (used by tests and dry runs). */
  openInBrowser?: boolean
  /** When true, do not write files; only resolve and return the planned paths. */
  dryRun?: boolean
  /** Allow tests / CI to inject the opener. Defaults to the system `open` / `xdg-open`. */
  openerFactory?: () => Opener
}

export type PreviewResult = {
  outDir: string
  findingsHtml?: string
  progressHtml?: string
  opened?: string
  dryRun?: boolean
}

export type Opener = (filePath: string) => Promise<void>

function defaultOpener(): Opener {
  return async (filePath) => {
    const bin = process.platform === 'darwin' ? 'open' : 'xdg-open'
    const proc = Bun.spawn([bin, filePath], { stdout: 'inherit', stderr: 'inherit' })
    await proc.exited
  }
}

function defaultFixtureDir(): string {
  // The fixture lives next to this script, under fixtures/example-pr.
  return new URL('../fixtures/example-pr', import.meta.url).pathname
}

function defaultOutDir(): string {
  const home = process.env.HOME || '/tmp'
  return join(home, '.magpie', `preview-${Date.now()}`)
}

async function readFixture(fixtureDir: string): Promise<{
  pr: { number: number; branch: string; headSha: string }
  findings: ReturnType<typeof parseFinding>[]
  postStatus: PostStatusMap
  files: Array<{ path: string; additions: number; deletions: number }>
  diff: string
  brief: PrBrief | undefined
}> {
  const prRaw = JSON.parse(await readFile(join(fixtureDir, 'pr.json'), 'utf8')) as Record<
    string,
    unknown
  >
  const findingsRaw = JSON.parse(
    await readFile(join(fixtureDir, 'findings.final.json'), 'utf8'),
  ) as unknown[]
  let postStatusRaw: Record<string, unknown> = {}
  try {
    postStatusRaw = JSON.parse(
      await readFile(join(fixtureDir, 'post-status.json'), 'utf8'),
    ) as Record<string, unknown>
  } catch {
    // optional file
  }
  let filesArray: Array<{ path: string; additions: number; deletions: number }> = []
  if (Array.isArray(prRaw.files)) {
    filesArray = (prRaw.files as unknown[]).map((f) => {
      const entry = f as Record<string, unknown>
      return {
        path: String(entry.path ?? ''),
        additions: Number(entry.additions ?? 0),
        deletions: Number(entry.deletions ?? 0),
      }
    })
  }
  let diff = ''
  try {
    diff = await readFile(join(fixtureDir, 'diff.patch'), 'utf8')
  } catch {
    // optional file
  }
  let brief: PrBrief | undefined
  try {
    const briefRaw = JSON.parse(await readFile(join(fixtureDir, 'brief.json'), 'utf8'))
    brief = parseBrief(briefRaw) ?? undefined
  } catch {
    // optional file
  }
  return {
    pr: {
      number: Number(prRaw.number ?? 0),
      branch: String(prRaw.headRefName ?? '?'),
      headSha: String(prRaw.headRefOid ?? '?'),
    },
    findings: findingsRaw.map((raw) => parseFinding(raw)),
    postStatus: postStatusRaw as PostStatusMap,
    files: filesArray,
    diff,
    brief,
  }
}

function progressInput(
  pr: { number: number; branch: string; headSha: string },
  stage: StagePreset,
): RenderProgressInput {
  const preset = STAGE_PRESETS[stage]
  return {
    prNumber: pr.number,
    branch: pr.branch,
    headSha: pr.headSha,
    stages: preset.stages,
    specialistCounts: preset.counts,
  }
}

export async function runPreview(opts: PreviewOptions): Promise<PreviewResult> {
  const fixtureDir = opts.fixtureDir ?? defaultFixtureDir()
  const outDir = opts.outDir ?? defaultOutDir()
  const fixture = await readFixture(fixtureDir)
  const findingsPath = join(outDir, 'findings.html')
  const progressPath = join(outDir, 'progress.html')

  if (opts.dryRun) {
    return {
      outDir,
      ...(opts.page !== 'progress' ? { findingsHtml: findingsPath } : {}),
      ...(opts.page !== 'findings' ? { progressHtml: progressPath } : {}),
      dryRun: true,
    }
  }

  await mkdir(outDir, { recursive: true })

  const result: PreviewResult = { outDir }

  if (opts.page !== 'progress') {
    await renderFindingsToDisk(
      {
        findings: fixture.findings,
        postStatus: fixture.postStatus,
        runId: `preview-${opts.stage}`,
        pr: fixture.pr,
        files: fixture.files,
        diff: fixture.diff,
        brief: fixture.brief,
      },
      findingsPath,
    )
    result.findingsHtml = findingsPath
  }

  if (opts.page !== 'findings') {
    await renderProgressToDisk(progressInput(fixture.pr, opts.stage), progressPath)
    result.progressHtml = progressPath
  }

  if (opts.openInBrowser !== false) {
    const opener = (opts.openerFactory ?? defaultOpener)()
    // Open findings if requested, else progress.
    const target =
      opts.page === 'progress'
        ? progressPath
        : opts.page === 'findings'
          ? findingsPath
          : findingsPath
    await opener(target)
    result.opened = target
  }

  return result
}

export const KNOWN_STAGE_PRESETS = Object.keys(STAGE_PRESETS) as StagePreset[]
