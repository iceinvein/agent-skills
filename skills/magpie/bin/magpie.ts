#!/usr/bin/env bun

import pkg from '../package.json' with { type: 'json' }

const VERSION = (pkg as { version: string }).version

const USAGE = `Usage: magpie <subcommand> [args]

Subcommands:
  setup <run-dir> --pr <n>   Pre-flight, fetch PR, create worktree
  serve <run-dir-or-id>      Start the HTML server (accepts active or archived run id)
  dedupe <run-dir>           Merge specialist findings into deduped set
  render <run-dir> <page>    Render progress.html or findings.html
  cleanup <run-dir>          Remove worktree, stop server, archive run
  status <run-dir>           Print highest completed stage
  open [id]                  Open findings.html in your browser (defaults to latest run)
  post <run-dir> --ids a,b   Post the given finding ids via gh (rich body + optional summary)
  preview [opts]             Render the UI from a bundled fixture (no PR needed). See --help-preview.
  --list-runs                List archived runs
  --cleanup-run <id>         Delete an archived run
  --version                  Print the magpie version
  --help                     Show this message`

const USAGE_PREVIEW = `Usage: magpie preview [options]

Render the findings and/or progress pages from a bundled example PR fixture so
you can iterate on the UI without running a real review.

Options:
  --page <findings|progress|both>   Which page to render (default: both)
  --stage <preset>                  Pipeline state preset for the progress page
                                    (default: report-done)
  --fixture <dir>                   Override the fixture directory
  --out <dir>                       Where to write the HTML (default: ~/.magpie/preview-<ts>)
  --no-open                         Don't open the page in your browser
  --dry-run                         Print the paths that would be written, write nothing
  --list-stages                     List the known --stage presets and exit
  --help                            Show this message

Stage presets: fresh, setup-running, setup-done, context-skipped,
specialists-running, specialists-done, dedupe-done, critic-done,
peer-review-error, report-done, post-done.`

type Handler = (args: string[]) => Promise<number> | number

const HANDLERS: Record<string, Handler> = {
  setup: async (args) => {
    const runDir = args[0]
    const prFlag = args.indexOf('--pr')
    const prValue = prFlag !== -1 ? args[prFlag + 1] : undefined
    const repoFlag = args.indexOf('--repo')
    if (!runDir || prFlag === -1 || !prValue) {
      process.stderr.write('setup: missing <run-dir> --pr <n> [--repo <path>]\n')
      return 2
    }
    const prNumber = Number(prValue)
    if (!Number.isFinite(prNumber)) {
      process.stderr.write(`setup: invalid PR number ${prValue}\n`)
      return 2
    }
    const repoPath = (repoFlag !== -1 ? args[repoFlag + 1] : undefined) ?? process.cwd()
    const { runSetup } = await import('../scripts/setup-cmd.ts')
    return runSetup({ runDir, prNumber, repoPath })
  },
  serve: async (args) => {
    const idOrPath = args[0]
    if (!idOrPath) {
      process.stderr.write('serve: missing <run-dir-or-id>\n')
      return 2
    }
    const idleFlag = args.indexOf('--idle-ms')
    const idleRaw = idleFlag !== -1 ? args[idleFlag + 1] : undefined
    const idleMs = idleRaw !== undefined ? Number(idleRaw) : 30 * 60 * 1000
    if (!Number.isFinite(idleMs) || idleMs <= 0) {
      process.stderr.write(`serve: invalid --idle-ms ${idleRaw}\n`)
      return 2
    }
    const hostFlag = args.indexOf('--host')
    const host = hostFlag !== -1 ? args[hostFlag + 1] : undefined
    let runDir: string
    if (idOrPath.includes('/') || idOrPath.startsWith('.')) {
      runDir = idOrPath
    } else {
      const { resolveRunDir } = await import('../scripts/resolve-run.ts')
      try {
        runDir = (await resolveRunDir(idOrPath)).path
      } catch (err) {
        process.stderr.write(`serve: ${err instanceof Error ? err.message : String(err)}\n`)
        return 2
      }
    }
    // Auto-refresh: re-render findings.html with the currently-shipped CSS/JS
    // so serving an old archive picks up new report features. Best-effort.
    const { refreshFindings } = await import('../scripts/refresh.ts')
    await refreshFindings(runDir).catch(() => {})
    const { runServe } = await import('../scripts/serve-cmd.ts')
    return runServe({ runDir, idleMs, host })
  },
  dedupe: async (args) => {
    const runDir = args[0]
    if (!runDir) {
      process.stderr.write('dedupe: missing <run-dir>\n')
      return 2
    }
    const { runDedupe } = await import('../scripts/dedupe-cmd.ts')
    return runDedupe(runDir)
  },
  render: async (args) => {
    const runDir = args[0]
    const page = args[1]
    if (!runDir || (page !== 'progress' && page !== 'findings')) {
      process.stderr.write('render: missing <run-dir> <progress|findings>\n')
      return 2
    }
    const { runRender } = await import('../scripts/render-cmd.ts')
    return runRender(runDir, page)
  },
  cleanup: async (args) => {
    const runDir = args[0]
    const repoFlag = args.indexOf('--repo')
    const graceFlag = args.indexOf('--kill-grace-ms')
    if (!runDir) {
      process.stderr.write('cleanup: missing <run-dir> [--repo <path>] [--kill-grace-ms <n>]\n')
      return 2
    }
    const repoPath = (repoFlag !== -1 ? args[repoFlag + 1] : undefined) ?? process.cwd()
    const killGraceRaw = graceFlag !== -1 ? args[graceFlag + 1] : undefined
    const killGraceMs = killGraceRaw !== undefined ? Number(killGraceRaw) : undefined
    if (killGraceMs !== undefined && (!Number.isFinite(killGraceMs) || killGraceMs < 0)) {
      process.stderr.write(`cleanup: invalid --kill-grace-ms ${killGraceRaw}\n`)
      return 2
    }
    const { runCleanup } = await import('../scripts/cleanup-cmd.ts')
    return runCleanup({
      runDir,
      repoPath,
      gitBin: process.env.MAGPIE_GIT_BIN || 'git',
      killGraceMs,
    })
  },
  status: async (args) => {
    const runDir = args[0]
    if (!runDir) {
      process.stderr.write('status: missing <run-dir>\n')
      return 2
    }
    const { runStatus } = await import('../scripts/status-cmd.ts')
    const result = await runStatus(runDir)
    process.stdout.write(`${JSON.stringify(result)}\n`)
    return 0
  },
  open: async (args) => {
    const dryRun = args.includes('--dry-run')
    const positional = args.filter((a) => !a.startsWith('--'))
    const idOrPath = positional[0]
    const { runOpen } = await import('../scripts/open-cmd.ts')
    return runOpen({ idOrPath, dryRun })
  },
  post: async (args) => {
    const runDir = args[0]
    if (!runDir) {
      process.stderr.write(
        'post: missing <run-dir> --ids <a,b,c> [--include-summary auto|always|never] [--dry-run]\n',
      )
      return 2
    }
    const idsFlag = args.indexOf('--ids')
    const idsRaw = idsFlag !== -1 ? args[idsFlag + 1] : undefined
    if (!idsRaw) {
      process.stderr.write('post: missing --ids <a,b,c>\n')
      return 2
    }
    const findingIds = idsRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (findingIds.length === 0) {
      process.stderr.write('post: --ids is empty\n')
      return 2
    }
    const summaryFlag = args.indexOf('--include-summary')
    const summaryRaw = summaryFlag !== -1 ? args[summaryFlag + 1] : undefined
    const includeSummary =
      summaryRaw === 'auto' || summaryRaw === 'always' || summaryRaw === 'never'
        ? summaryRaw
        : undefined
    if (summaryRaw !== undefined && includeSummary === undefined) {
      process.stderr.write(`post: invalid --include-summary ${summaryRaw}\n`)
      return 2
    }
    const dryRun = args.includes('--dry-run')
    const { runPost } = await import('../scripts/post-cmd.ts')
    const outcome = await runPost({
      runDir,
      findingIds,
      dryRun,
      ...(includeSummary ? { includeSummary } : {}),
    })
    process.stdout.write(`${JSON.stringify(outcome)}\n`)
    return outcome.ok ? 0 : 1
  },
  preview: async (args) => {
    if (args.includes('--help') || args.includes('-h')) {
      process.stdout.write(`${USAGE_PREVIEW}\n`)
      return 0
    }
    const { KNOWN_STAGE_PRESETS, DEFAULT_STAGE, runPreview } = await import(
      '../scripts/preview-cmd.ts'
    )
    if (args.includes('--list-stages')) {
      for (const s of KNOWN_STAGE_PRESETS) process.stdout.write(`${s}\n`)
      return 0
    }
    const pageFlag = args.indexOf('--page')
    const pageRaw = pageFlag !== -1 ? args[pageFlag + 1] : 'both'
    if (pageRaw !== 'findings' && pageRaw !== 'progress' && pageRaw !== 'both') {
      process.stderr.write(`preview: invalid --page ${pageRaw} (want findings|progress|both)\n`)
      return 2
    }
    const stageFlag = args.indexOf('--stage')
    const stageRaw = stageFlag !== -1 ? args[stageFlag + 1] : DEFAULT_STAGE
    if (!stageRaw || !KNOWN_STAGE_PRESETS.includes(stageRaw as never)) {
      process.stderr.write(
        `preview: invalid --stage ${stageRaw}. Use --list-stages to see available presets.\n`,
      )
      return 2
    }
    const fixtureFlag = args.indexOf('--fixture')
    const outFlag = args.indexOf('--out')
    const result = await runPreview({
      page: pageRaw,
      stage: stageRaw as never,
      ...(fixtureFlag !== -1 && args[fixtureFlag + 1] ? { fixtureDir: args[fixtureFlag + 1] } : {}),
      ...(outFlag !== -1 && args[outFlag + 1] ? { outDir: args[outFlag + 1] } : {}),
      openInBrowser: !args.includes('--no-open') && !args.includes('--dry-run'),
      dryRun: args.includes('--dry-run'),
    })
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return 0
  },
  '--list-runs': async () => {
    const { listRuns } = await import('../scripts/housekeeping-cmd.ts')
    const runs = await listRuns()
    for (const r of runs) {
      process.stdout.write(`${r.id}\t${r.archived ? 'archived' : 'active'}\t${r.path}\n`)
    }
    return 0
  },
  '--cleanup-run': async (args) => {
    const id = args[0]
    if (!id) {
      process.stderr.write('--cleanup-run: missing <id>\n')
      return 2
    }
    const { cleanupRun } = await import('../scripts/housekeeping-cmd.ts')
    return cleanupRun(undefined, id)
  },
}

async function main(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv
  if (sub === '--help' || sub === '-h') {
    process.stdout.write(`${USAGE}\n`)
    return 0
  }
  if (sub === '--version' || sub === '-V') {
    process.stdout.write(`magpie ${VERSION}\n`)
    return 0
  }
  if (!sub) {
    process.stderr.write(`${USAGE}\n`)
    return 2
  }
  const handler = HANDLERS[sub]
  if (!handler) {
    process.stderr.write(`Unknown subcommand: ${sub}\n${USAGE}\n`)
    return 2
  }
  return await handler(rest)
}

const code = await main(process.argv.slice(2))
process.exit(code)
