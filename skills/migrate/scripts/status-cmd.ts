import { runCheck } from './check.ts'
import { loadConfig } from './config.ts'
import { storePaths } from './paths.ts'
import { loadPhases, PHASES } from './phases.ts'
import { loadQueue } from './queue.ts'
import { readRows } from './store.ts'
import type { Element, Requirement } from './types.ts'

export async function runStatus(opts: { root: string }): Promise<number> {
  const cfg = await loadConfig(opts.root)
  const p = storePaths(opts.root)
  const phases = await loadPhases(opts.root)
  const elements = await readRows<Element>(p.elements)
  const requirements = await readRows<Requirement>(p.requirements)
  const { items } = await loadQueue(p.queueDir)
  const open = items.filter((i) => i.status === 'open')

  process.stdout.write(`source: ${cfg.source.path} (${cfg.source.stack}, ${cfg.source.basis})\n`)
  process.stdout.write(`scope:  ${cfg.source.scope}\n\n`)

  for (const phase of PHASES) {
    const state = phases[phase]
    const batches = state.batches.length > 0 ? ` (${state.batches.length} batch(es))` : ''
    process.stdout.write(`  ${phase.padEnd(11)} ${state.status}${batches}\n`)
  }

  const { summary } = await runCheck({ root: opts.root })
  process.stdout.write(`\n${summary}\n`)
  process.stdout.write(`${requirements.length} requirement(s), ${elements.length} element(s)\n`)
  process.stdout.write(`${open.length} open queue item(s) of ${items.length}\n`)

  const active = PHASES.find((ph) => phases[ph].status !== 'done')
  if (active) {
    const last = phases[active].batches.at(-1)
    const from = last ? `last batch ${last.id} (${last.count} row(s))` : 'no batches yet'
    process.stdout.write(`\nresume: ${active}, ${from}\n`)
    if (phases[active].pending.length > 0) {
      process.stdout.write(`pending: ${phases[active].pending.join(', ')}\n`)
    }
  } else {
    process.stdout.write('\nresume: all phases done\n')
  }
  return 0
}
