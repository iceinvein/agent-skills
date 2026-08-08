import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { runCheck } from './check.ts'
import { loadConfig } from './config.ts'
import { assertNotUnderSource, storePaths } from './paths.ts'
import { loadQueue } from './queue.ts'
import { renderLedger, renderQueueReport, renderRequirements } from './report.ts'
import { readRows, writeAtomically } from './store.ts'
import type { Element, Requirement } from './types.ts'

export async function runReport(opts: { root: string; outDir?: string }): Promise<number> {
  const cfg = await loadConfig(opts.root)
  const p = storePaths(opts.root)
  const outDir = opts.outDir ?? join(opts.root, 'docs', 'migrate')
  await assertNotUnderSource(outDir, cfg.source.path)
  await mkdir(outDir, { recursive: true })

  const elements = await readRows<Element>(p.elements)
  const requirements = await readRows<Requirement>(p.requirements)
  const { items, errors } = await loadQueue(p.queueDir)
  // A queue item the report cannot parse is not represented in queue.md at
  // all: silently emitting a file that only covers the parseable items,
  // under a banner claiming it was generated from the store, would let an
  // owner reading it conclude there is nothing else to adjudicate. Surfaced
  // the same way every other command in this CLI surfaces a domain problem
  // on an otherwise well-formed request: named on stderr, non-zero exit.
  for (const e of errors) process.stderr.write(`report: ${e}\n`)
  const { summary } = await runCheck({ root: opts.root })

  // Through writeAtomically rather than writeFile, so the three rendered views
  // get temp-plus-rename like every store file: a report is what a human opens
  // to read the run, and a truncated one is worse than a stale one. The
  // explicit assertNotUnderSource on outDir above is still needed regardless,
  // because the mkdir happens before any of these three run.
  const src = cfg.source.path
  await writeAtomically(join(outDir, 'ledger.md'), `${renderLedger(elements)}\n${summary}\n`, src)
  await writeAtomically(join(outDir, 'requirements.md'), renderRequirements(requirements), src)
  await writeAtomically(join(outDir, 'queue.md'), renderQueueReport(items), src)

  process.stdout.write(`report: wrote ledger.md, requirements.md, queue.md to ${outDir}\n`)
  // A malformed queue item is a content failure on an otherwise well-formed
  // request (the store exists and could be read), the same class `queue
  // list` already reports as exit 1 for the identical condition -- not a
  // usage error (2, this request was perfectly serviceable) and not success
  // (0, the report is incomplete).
  return errors.length > 0 ? 1 : 0
}
