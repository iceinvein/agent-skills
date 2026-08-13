import { existsSync } from 'node:fs'
import type { Violation } from '../types.ts'
import type { Gate } from './context.ts'

async function sourceIsDirty(sourcePath: string, gitBin: string): Promise<boolean> {
  if (!existsSync(`${sourcePath}/.git`)) return false
  const proc = Bun.spawn([gitBin, 'status', '--porcelain'], {
    cwd: sourcePath,
    stdout: 'pipe',
    stderr: 'ignore',
  })
  const out = await new Response(proc.stdout).text()
  await proc.exited
  return out.trim().length > 0
}

// Gate 9: source integrity. A source that is not a git checkout cannot be
// checked this way and is not reported as a violation; the CLI's own refusal
// to write any path under the source root is what covers that case.
export const gate: Gate = async (ctx): Promise<Violation[]> => {
  if (!(await sourceIsDirty(ctx.cfg.source.path, ctx.gitBin))) return []
  return [
    {
      gate: 'source',
      message: `the source checkout at ${ctx.cfg.source.path} has uncommitted changes; it must stay read-only`,
    },
  ]
}
