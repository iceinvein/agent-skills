import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runCheck } from './check.ts'
import { loadConfig } from './config.ts'
import { assertNotUnderSource, storePaths } from './paths.ts'
import { loadQueue } from './queue.ts'
import { renderLedger, renderQueueReport, renderRequirements } from './report.ts'
import { readRows } from './store.ts'
import type { Element, Requirement } from './types.ts'

export async function runReport(opts: { root: string; outDir?: string }): Promise<number> {
  const cfg = await loadConfig(opts.root)
  const p = storePaths(opts.root)
  const outDir = opts.outDir ?? join(opts.root, 'docs', 'migrate')
  assertNotUnderSource(outDir, cfg.source.path)
  await mkdir(outDir, { recursive: true })

  const elements = await readRows<Element>(p.elements)
  const requirements = await readRows<Requirement>(p.requirements)
  const { items } = await loadQueue(p.queueDir)
  const { summary } = await runCheck({ root: opts.root })

  await writeFile(join(outDir, 'ledger.md'), `${renderLedger(elements)}\n${summary}\n`)
  await writeFile(join(outDir, 'requirements.md'), renderRequirements(requirements))
  await writeFile(join(outDir, 'queue.md'), renderQueueReport(items))

  process.stdout.write(`report: wrote ledger.md, requirements.md, queue.md to ${outDir}\n`)
  return 0
}
