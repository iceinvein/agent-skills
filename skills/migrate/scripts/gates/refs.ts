import type { Violation } from '../types.ts'
import type { Gate } from './context.ts'

// A duplicate id or slug within one store file is a real defect the refs
// gate must catch on its own, not something it can assume another gate or
// command already ruled out: `import reqs` upserts by id, but
// capabilities.jsonl has no import path at all today, so hand-editing is
// currently the only way a row lands there, and nothing stops two rows
// from hand-editing into the same identity with different content. A
// gate whose soundness depends on another gate having run first is not
// independently a gate. Counted off the raw row arrays, not a `Set`:
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

// Gate 3: referential integrity.
export const gate: Gate = (ctx): Violation[] => {
  const violations: Violation[] = []
  const reqIds = new Set(ctx.requirements.map((r) => r.id))
  const elementIds = new Set(ctx.elements.map((e) => e.id))
  const capSlugs = new Set(ctx.capabilities.map((c) => c.slug))
  const queueIds = new Set(ctx.queueItems.map((q) => q.id))

  for (const [id, count] of duplicatesOf(ctx.requirements.map((r) => r.id))) {
    violations.push({
      gate: 'refs',
      message: `requirement id ${id} appears ${count} times in requirements.jsonl`,
    })
  }
  for (const [slug, count] of duplicatesOf(ctx.capabilities.map((c) => c.slug))) {
    violations.push({
      gate: 'refs',
      message: `capability slug ${slug} appears ${count} times in capabilities.jsonl`,
    })
  }
  for (const [id, count] of duplicatesOf(ctx.elements.map((e) => e.id))) {
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
  for (const el of ctx.elements) {
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
  for (const req of ctx.requirements) {
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
  return violations
}
