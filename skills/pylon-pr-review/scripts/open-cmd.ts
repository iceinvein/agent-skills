import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveRunDir } from './resolve-run.ts'

export type OpenInput = {
  idOrPath?: string
  home?: string
  // Test seam: prints the open command instead of spawning.
  dryRun?: boolean
  // Test seam: explicit opener binary, otherwise platform default.
  opener?: string
  platform?: NodeJS.Platform
}

function defaultOpener(platform: NodeJS.Platform): string {
  if (platform === 'darwin') return 'open'
  if (platform === 'win32') return 'start'
  return 'xdg-open'
}

async function firstExisting(paths: string[]): Promise<string | null> {
  for (const p of paths) {
    const s = await stat(p).catch(() => null)
    if (s?.isFile()) return p
  }
  return null
}

export async function runOpen(input: OpenInput): Promise<number> {
  let resolved: Awaited<ReturnType<typeof resolveRunDir>>
  try {
    resolved = await resolveRunDir(input.idOrPath, input.home)
  } catch (err) {
    process.stderr.write(`open: ${err instanceof Error ? err.message : String(err)}\n`)
    return 1
  }

  const target = await firstExisting([
    join(resolved.path, 'screen', 'findings.html'),
    join(resolved.path, 'screen', 'progress.html'),
  ])
  if (!target) {
    process.stderr.write(`open: no findings.html or progress.html in ${resolved.path}/screen\n`)
    return 2
  }

  const opener =
    input.opener ??
    process.env.PR_REVIEW_OPENER ??
    defaultOpener(input.platform ?? process.platform)

  if (input.dryRun) {
    process.stdout.write(`${opener} ${target}\n`)
    return 0
  }

  const proc = Bun.spawn([opener, target], { stdout: 'inherit', stderr: 'inherit' })
  const exit = await proc.exited
  if (exit !== 0) {
    process.stderr.write(`open: ${opener} exited ${exit}; you can open it manually: ${target}\n`)
    return exit
  }
  return 0
}
