import { censusSubject } from '../census.ts'
import type { Violation } from '../types.ts'
import { type Gate, validCensus } from './context.ts'

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

  // An element's ledger refs are the only edges seam's surface-affinity
  // validator clusters on. enumerate.md lets a lens point at an id another
  // lens has not added yet, and this gate is not phase-scoped, so a
  // `check --phase enumerate` after one lens's batch reports refs to
  // elements the next lens will add. That noise is expected mid-enumerate
  // and clears when the other lens's batch lands; one still dangling after
  // every lens has run is a misspelled id or an element never added.
  for (const el of ctx.elements) {
    for (const ref of el.refs) {
      if (ref.kind === 'ledger' && !elementIds.has(ref.id)) {
        violations.push({
          gate: 'refs',
          message: `element ${el.id} refs ledger id ${ref.id}, which is not in the ledger`,
        })
      }
    }
  }

  // capabilities.jsonl is the partition extract fans out over, one agent per
  // capability, and it is written by hand at seam. An element listed twice is
  // mined twice; an element listed nowhere is never mined at all, which no
  // other gate notices because coverage only asks whether it was mapped.
  const capsOf = new Map<string, string[]>()
  // A repeat inside one capability is a typo in that row, not a second
  // capability claiming the element, so it is named against the row and
  // counted once toward membership.
  for (const cap of ctx.capabilities) {
    for (const [id] of duplicatesOf(cap.elements)) {
      violations.push({
        gate: 'refs',
        message: `capability ${cap.slug} lists element ${id} more than once`,
      })
    }
    for (const id of new Set(cap.elements)) {
      if (!elementIds.has(id)) {
        violations.push({
          gate: 'refs',
          message: `capability ${cap.slug} lists element ${id}, which is not in the ledger`,
        })
        continue
      }
      capsOf.set(id, [...(capsOf.get(id) ?? []), cap.slug])
    }
  }
  for (const [id, slugs] of capsOf) {
    if (slugs.length > 1) {
      const named = `${slugs.slice(0, -1).join(', ')} and ${slugs[slugs.length - 1]}`
      violations.push({ gate: 'refs', message: `element ${id} sits in capabilities ${named}` })
    }
  }
  // Before seam writes the first row there is no partition to be missing
  // from, and an out-of-scope element is deliberately not extracted.
  if (ctx.capabilities.length > 0) {
    for (const el of ctx.elements) {
      if (el.disposition.kind !== 'out-of-scope' && !capsOf.has(el.id)) {
        violations.push({
          gate: 'refs',
          message: `element ${el.id} is in no capability, so extract will never reach it`,
        })
      }
    }
  }

  // Every census kind carries `queued`, the ids of the queue items it parked
  // its remainder in, and balanceOf counts them toward the record's total. A
  // queued id with no file behind it balances the arithmetic with a decision
  // nobody can ever see or make.
  for (const record of validCensus(ctx.censusRows)) {
    for (const qid of record.queued) {
      if (!queueIds.has(qid)) {
        violations.push({
          gate: 'refs',
          message: `${record.kind} census for ${censusSubject(record)} queues ${qid}, which does not exist`,
        })
      }
    }
  }
  return violations
}
