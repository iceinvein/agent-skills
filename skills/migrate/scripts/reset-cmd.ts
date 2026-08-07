import { rm } from 'node:fs/promises'
import { loadConfig } from './config.ts'
import { storePaths } from './paths.ts'
import { isPhase, loadPhases, savePhases } from './phases.ts'
import { readRows, writeRows } from './store.ts'
import type { Census, Element, Requirement } from './types.ts'

export async function runReset(opts: { root: string; phase: string }): Promise<number> {
  if (!isPhase(opts.phase)) {
    process.stderr.write(`reset: unknown phase ${opts.phase}\n`)
    return 2
  }
  const cfg = await loadConfig(opts.root)
  const p = storePaths(opts.root)
  const src = cfg.source.path
  const cleared: string[] = []

  if (opts.phase === 'enumerate') {
    await writeRows(p.elements, [], src)
    const census = await readRows<Census>(p.census)
    await writeRows(
      p.census,
      census.filter((c) => c.kind !== 'lens'),
      src,
    )
    cleared.push('elements', 'lens census')
  }

  if (opts.phase === 'seam') {
    await writeRows(p.capabilities, [], src)
    await rm(p.seamJson, { force: true })
    await rm(p.seamMd, { force: true })
    cleared.push('capabilities', 'seam')
  }

  if (opts.phase === 'extract') {
    await writeRows(p.requirements, [], src)
    const census = await readRows<Census>(p.census)
    await writeRows(
      p.census,
      census.filter((c) => c.kind === 'lens'),
      src,
    )
    const elements = await readRows<Element>(p.elements)
    await writeRows(
      p.elements,
      elements.map((e) => ({ ...e, disposition: { kind: 'unaccounted' as const } })),
      src,
    )
    cleared.push('requirements', 'attribute/rule-sweep/closer census', 'element dispositions')
  }

  if (opts.phase === 'parity') {
    await writeRows(p.deltas, [], src)
    const reqs = await readRows<Requirement>(p.requirements)
    await writeRows(
      p.requirements,
      reqs.map((r) => ({ ...r, parity: null })),
      src,
    )
    cleared.push('deltas', 'parity plans')
  }

  const phases = await loadPhases(opts.root)
  phases[opts.phase] = { status: 'pending', batches: [], pending: [] }
  await savePhases(opts.root, phases, src)

  const what = cleared.length > 0 ? `: cleared ${cleared.join(', ')}` : ' (state only)'
  process.stdout.write(`reset ${opts.phase}${what}\n`)
  return 0
}
