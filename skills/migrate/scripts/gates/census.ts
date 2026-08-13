import { balanceOf, boundsOf, censusKey } from '../census.ts'
import type { Census, Violation } from '../types.ts'
import { isRecord } from '../validate.ts'
import type { Gate } from './context.ts'

// A hand-edited census.jsonl never passes through census-cmd.ts's
// validateCensus call, so this is the only label available for a row that
// fails the check below: its 1-based position in the file, plus (when kind
// and the field censusKey needs both parse as strings) the same key
// census-cmd.ts uses to identify a record, so the message points at
// something the reader can find rather than an opaque line number alone.
function censusRowLabel(raw: unknown, line: number): string {
  const base = `census.jsonl line ${line}`
  if (!isRecord(raw)) return base
  const kind = raw.kind
  if (kind === 'lens' && typeof raw.surface === 'string')
    return `${base} (${censusKey(raw as Census)})`
  if (kind === 'attribute' && typeof raw.subject === 'string')
    return `${base} (${censusKey(raw as Census)})`
  if (kind === 'rule-sweep' && typeof raw.subject === 'string')
    return `${base} (${censusKey(raw as Census)})`
  if (kind === 'closer' && typeof raw.closer === 'string')
    return `${base} (${censusKey(raw as Census)})`
  return base
}

// Gate 2: census shape, balance and presence. Rows are validated in runCheck,
// not here, because gate 10 needs the same partition; this gate reports the
// shape failures and does the arithmetic. A row that failed validation is
// excluded from balanceOf, boundsOf, and the in_ledger + added reconciliation:
// all three assume a well-formed record, so running them on one that already
// failed shape validation would add confusing noise on top of the real defect
// rather than a second independent fact.
export const gate: Gate = (ctx): Violation[] => {
  const violations: Violation[] = []
  const surfacesWithCensus = new Set<string>()
  const closersWithCensus = new Set<string>()

  for (const row of ctx.censusRows) {
    if (!row.ok) {
      const label = censusRowLabel(row.raw, row.line)
      for (const error of row.errors) {
        violations.push({ gate: 'census', message: `${label}: ${error}` })
      }
      // A row that fails validation still ran and still named a surface or
      // closer it claims to cover; only its shape is defective, not its
      // existence. Registered defensively here (guarded the same way
      // censusRowLabel is, since the row is not a trustworthy Census) so
      // gate 2 does not also claim that surface or closer has no census
      // record at all, which is a different and wrong accusation: that
      // message means the lens never ran or never closed, not that it ran
      // and produced something malformed. A row whose kind or identity
      // field does not even parse as a string cannot make this claim, so it
      // falls through to the genuinely-missing check below unregistered.
      if (isRecord(row.raw)) {
        if (row.raw.kind === 'lens' && typeof row.raw.surface === 'string') {
          surfacesWithCensus.add(row.raw.surface)
        } else if (row.raw.kind === 'closer' && typeof row.raw.closer === 'string') {
          closersWithCensus.add(row.raw.closer)
        }
      }
      continue
    }
    const record = row.record
    const imbalance = balanceOf(record)
    if (imbalance) violations.push({ gate: 'census', message: imbalance })
    const outOfBounds = boundsOf(record)
    if (outOfBounds) violations.push({ gate: 'census', message: outOfBounds })
    if (record.kind === 'lens') {
      surfacesWithCensus.add(record.surface)
      // balanceOf only checks that the record's own numbers add up
      // internally; nothing before this ties in_ledger + added to anything
      // outside the record itself, so a lens census can balance perfectly
      // while claiming a headcount elements.jsonl never received (total is
      // self-reported and cannot be checked against anything, but in_ledger
      // + added claims a specific number of rows now exist in the ledger
      // for this surface, and that claim is directly countable).
      const claimed = record.in_ledger + record.added
      const actual = ctx.elements.filter((e) => e.surface === record.surface).length
      if (actual !== claimed) {
        violations.push({
          gate: 'census',
          message: `lens census for ${record.surface} claims in_ledger ${record.in_ledger} + added ${record.added} = ${claimed} element(s) in the ledger, but elements.jsonl has ${actual}`,
        })
      }
    }
    if (record.kind === 'closer') closersWithCensus.add(record.closer)
  }

  for (const surface of ctx.cfg.surfaces) {
    if (!surfacesWithCensus.has(surface)) {
      violations.push({
        gate: 'census',
        message: `declared surface ${surface} has no lens census record; the lens did not run or did not close`,
      })
    }
  }
  for (const closer of ctx.cfg.closers) {
    if (!closersWithCensus.has(closer)) {
      violations.push({
        gate: 'census',
        message: `declared closer ${closer} has no census record`,
      })
    }
  }
  return violations
}
