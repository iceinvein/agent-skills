import { rm } from 'node:fs/promises'
import { loadConfig } from './config.ts'
import { LockError, withStoreLock } from './lock.ts'
import { type StorePaths, storePaths } from './paths.ts'
import { isPhase, loadPhases, type Phase, savePhases } from './phases.ts'
import { readRows, writeRows } from './store.ts'
import type { Census, Element, Requirement } from './types.ts'

export async function runReset(opts: {
  root: string
  phase: string
  forceUnlock?: boolean
}): Promise<number> {
  if (!isPhase(opts.phase)) {
    process.stderr.write(`reset: unknown phase ${opts.phase}\n`)
    return 2
  }
  const phase = opts.phase
  const cfg = await loadConfig(opts.root)
  const p = storePaths(opts.root)
  const src = cfg.source.path

  // reset performs the same read-modify-write over whole store files that
  // import and census do -- it reads census.jsonl and elements.jsonl, filters
  // or rewrites every row, and writes the file back, then does the same to
  // phases.json -- and it was the one such command with no lock at all.
  // Concurrently with an importer that is mid-critical-section, either
  // rewrite can discard every row the other wrote, which is exactly the loss
  // the lock exists to stop. Nothing inside this critical section takes the
  // lock again: writeRows, readRows, loadPhases and savePhases are all
  // lock-free, and savePhases is deliberately called below instead of
  // setPhaseStatus, which is the one phases.ts helper that does take it.
  // withStoreLock is not reentrant, so that distinction is load-bearing
  // rather than incidental.
  let cleared: string[]
  try {
    cleared = await withStoreLock(opts.root, () => clearPhase(opts.root, phase, p, src), {
      cmd: 'reset',
      ...(opts.forceUnlock ? { force: true } : {}),
      onWait: (m) => process.stderr.write(`reset: ${m}\n`),
    })
  } catch (e) {
    // Same classification import, census and phase --status already use: a
    // lock failure is neither an unknown phase (2) nor a content failure (1);
    // the request is fine and would likely succeed on retry.
    if (e instanceof LockError) {
      process.stderr.write(`reset: ${e.message}\n`)
      return 3
    }
    throw e
  }

  const what = cleared.length > 0 ? `: cleared ${cleared.join(', ')}` : ' (state only)'
  process.stdout.write(`reset ${phase}${what}\n`)
  return 0
}

// The whole mutation, extracted so the critical section above is one call and
// the lock's extent is impossible to misread. Returns what it cleared, which
// is used only to build the stdout line, after the lock has been released.
async function clearPhase(
  root: string,
  phase: Phase,
  p: StorePaths,
  src: string,
): Promise<string[]> {
  const cleared: string[] = []

  if (phase === 'enumerate') {
    await writeRows(p.elements, [], src)
    const census = await readRows<Census>(p.census)
    await writeRows(
      p.census,
      census.filter((c) => c.kind !== 'lens'),
      src,
    )
    cleared.push('elements', 'lens census')
  }

  if (phase === 'seam') {
    await writeRows(p.capabilities, [], src)
    await rm(p.seamJson, { force: true })
    await rm(p.seamMd, { force: true })
    cleared.push('capabilities', 'seam')
  }

  if (phase === 'extract') {
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

  if (phase === 'parity') {
    await writeRows(p.deltas, [], src)
    const reqs = await readRows<Requirement>(p.requirements)
    await writeRows(
      p.requirements,
      reqs.map((r) => ({ ...r, parity: null })),
      src,
    )
    cleared.push('deltas', 'parity plans')
  }

  const phases = await loadPhases(root)
  phases[phase] = { status: 'pending', batches: [], pending: [] }
  await savePhases(root, phases, src)

  return cleared
}
