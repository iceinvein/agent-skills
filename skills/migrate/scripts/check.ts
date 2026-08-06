import { existsSync } from 'node:fs'
import { balanceOf } from './census.ts'
import { resolveCitations } from './citations.ts'
import { loadConfig } from './config.ts'
import { scanLeaks } from './leaks.ts'
import { storePaths } from './paths.ts'
import { loadQueue } from './queue.ts'
import { readRows } from './store.ts'
import type { Capability, Census, Delta, Element, Requirement, Violation } from './types.ts'

export type CheckResult = { summary: string; violations: Violation[] }

export const GATE_ORDER = [
  'coverage',
  'census',
  'refs',
  'queue',
  'deltas',
  'parity',
  'citations',
  'leaks',
  'source',
] as const

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

export async function runCheck(opts: {
  root: string
  citations?: boolean
  leaks?: boolean
  gitBin?: string
}): Promise<CheckResult> {
  const cfg = await loadConfig(opts.root)
  const paths = storePaths(opts.root)
  const gitBin = opts.gitBin ?? 'git'

  const elements = await readRows<Element>(paths.elements)
  const requirements = await readRows<Requirement>(paths.requirements)
  const capabilities = await readRows<Capability>(paths.capabilities)
  const deltas = await readRows<Delta>(paths.deltas)
  const census = await readRows<Census>(paths.census)
  const { items: queueItems, errors: queueErrors } = await loadQueue(paths.queueDir)

  const violations: Violation[] = []

  // Gate 1: coverage.
  let mapped = 0
  let outOfScope = 0
  let unaccounted = 0
  for (const el of elements) {
    if (el.disposition.kind === 'mapped') mapped++
    else if (el.disposition.kind === 'out-of-scope') outOfScope++
    else {
      unaccounted++
      violations.push({
        gate: 'coverage',
        message: `${el.id} (${el.surface}) is still unaccounted`,
      })
    }
  }
  const summary = `${mapped}/${elements.length} mapped, ${outOfScope} out-of-scope, ${unaccounted} unaccounted`

  // Gate 2: census balance and presence.
  const surfacesWithCensus = new Set<string>()
  const closersWithCensus = new Set<string>()
  for (const record of census) {
    const imbalance = balanceOf(record)
    if (imbalance) violations.push({ gate: 'census', message: imbalance })
    if (record.kind === 'lens') surfacesWithCensus.add(record.surface)
    if (record.kind === 'closer') closersWithCensus.add(record.closer)
  }
  for (const surface of cfg.surfaces) {
    if (!surfacesWithCensus.has(surface)) {
      violations.push({
        gate: 'census',
        message: `declared surface ${surface} has no lens census record; the lens did not run or did not close`,
      })
    }
  }
  for (const closer of cfg.closers) {
    if (!closersWithCensus.has(closer)) {
      violations.push({
        gate: 'census',
        message: `declared closer ${closer} has no census record`,
      })
    }
  }

  // Gate 3: referential integrity.
  const reqIds = new Set(requirements.map((r) => r.id))
  const elementIds = new Set(elements.map((e) => e.id))
  const capSlugs = new Set(capabilities.map((c) => c.slug))
  const queueIds = new Set(queueItems.map((q) => q.id))

  // A duplicate id or slug within one store file is a real defect the refs
  // gate must catch on its own, not something it can assume another gate or
  // command already ruled out: `import reqs` upserts by id, but
  // capabilities.jsonl has no import path at all today, so hand-editing is
  // currently the only way a row lands there, and nothing stops two rows
  // from hand-editing into the same identity with different content. A
  // gate whose soundness depends on another gate having run first is not
  // independently a gate (see Task 10's inverted citation range for the
  // same reasoning). Counted off the raw row arrays, not the `Set`s above:
  // a `Set` collapses duplicates by construction, which is exactly the
  // evidence (which id, how many rows) this check exists to preserve.
  function duplicatesOf(values: string[]): Map<string, number> {
    const counts = new Map<string, number>()
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
    const dups = new Map<string, number>()
    for (const [v, count] of counts) {
      if (count > 1) dups.set(v, count)
    }
    return dups
  }
  for (const [id, count] of duplicatesOf(requirements.map((r) => r.id))) {
    violations.push({
      gate: 'refs',
      message: `requirement id ${id} appears ${count} times in requirements.jsonl`,
    })
  }
  for (const [slug, count] of duplicatesOf(capabilities.map((c) => c.slug))) {
    violations.push({
      gate: 'refs',
      message: `capability slug ${slug} appears ${count} times in capabilities.jsonl`,
    })
  }
  for (const [id, count] of duplicatesOf(elements.map((e) => e.id))) {
    violations.push({
      gate: 'refs',
      message: `element id ${id} appears ${count} times in elements.jsonl`,
    })
  }

  // `field` names where the queue reference came from (`disposition.queue`,
  // `confidence.queue`, `parity.queue`) so that one requirement citing the
  // same missing queue id from two different fields produces two
  // violations that read as two distinct citations to fix, not one
  // ambiguous duplicate-looking line.
  const needQueue = (id: string, owner: string, field: string): void => {
    if (!queueIds.has(id)) {
      violations.push({
        gate: 'refs',
        message: `${owner} references queue item ${id} via ${field}, which does not exist`,
      })
    }
  }
  for (const el of elements) {
    if (el.disposition.kind === 'mapped' && !reqIds.has(el.disposition.fr)) {
      violations.push({
        gate: 'refs',
        message: `${el.id} is mapped to ${el.disposition.fr}, which is not in the registry`,
      })
    }
    if (el.disposition.kind === 'out-of-scope') {
      needQueue(el.disposition.queue, el.id, 'disposition.queue')
    }
  }
  for (const req of requirements) {
    if (!capSlugs.has(req.cap)) {
      violations.push({
        gate: 'refs',
        message: `${req.id} names capability ${req.cap}, which is not in the partition`,
      })
    }
    if (req.confidence.kind === 'queued')
      needQueue(req.confidence.queue, req.id, 'confidence.queue')
    if (req.parity?.kind === 'rubric' && req.parity.level !== 'high') {
      needQueue(req.parity.queue, req.id, 'parity.queue')
    }
    for (const ref of req.citations) {
      if (ref.kind === 'ledger' && !elementIds.has(ref.id)) {
        violations.push({
          gate: 'refs',
          message: `${req.id} cites ledger id ${ref.id}, which is not in the ledger`,
        })
      }
    }
  }

  // Gate 4: queue grammar.
  for (const message of queueErrors) violations.push({ gate: 'queue', message })

  // Gate 5: deltas.
  for (const delta of deltas) {
    if (!delta.owner_signed) {
      violations.push({ gate: 'deltas', message: `${delta.id} is not owner-signed` })
    }
  }

  // Gate 6: parity coverage.
  for (const req of requirements) {
    if (req.confidence.kind !== 'queued' && req.parity === null) {
      violations.push({ gate: 'parity', message: `${req.id} has no parity plan` })
    }
  }

  // Gate 7: citations, opt-in.
  if (opts.citations) {
    violations.push(...(await resolveCitations(requirements, cfg.source.path)))
  }

  // Gate 8: leaks, opt-in.
  if (opts.leaks) {
    violations.push(...(await scanLeaks({ root: opts.root, gitBin })))
  }

  // Gate 9: source integrity.
  if (await sourceIsDirty(cfg.source.path, gitBin)) {
    violations.push({
      gate: 'source',
      message: `the source checkout at ${cfg.source.path} has uncommitted changes; it must stay read-only`,
    })
  }

  const order = new Map(GATE_ORDER.map((g, i) => [g as string, i]))
  violations.sort((a, b) => (order.get(a.gate) ?? 99) - (order.get(b.gate) ?? 99))

  return { summary, violations }
}
