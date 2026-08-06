import type { Census } from './types.ts'
import type { Validated } from './validate.ts'
import { isRecord } from './validate.ts'

export function censusKey(record: Census): string {
  if (record.kind === 'lens') return `lens:${record.surface}`
  if (record.kind === 'attribute') return `attribute:${record.subject}`
  if (record.kind === 'rule-sweep') return `rule-sweep:${record.subject}`
  return `closer:${record.closer}`
}

export function balanceOf(record: Census): string | null {
  if (record.kind === 'lens') {
    const sum = record.in_ledger + record.added + record.skipped.length + record.queued.length
    if (sum !== record.total) {
      return `lens census for ${record.surface} does not balance: total ${record.total} but in_ledger ${record.in_ledger} + added ${record.added} + skipped ${record.skipped.length} + queued ${record.queued.length} = ${sum}`
    }
    return null
  }
  if (record.kind === 'attribute') {
    const sum = record.explained + record.queued.length
    if (sum !== record.behavioral) {
      return `attribute census for ${record.subject} does not balance: behavioral ${record.behavioral} but explained ${record.explained} + queued ${record.queued.length} = ${sum}`
    }
    return null
  }
  if (record.kind === 'rule-sweep') {
    const sum = record.as_requirements + record.queued.length
    if (sum !== record.found) {
      return `rule-sweep census for ${record.subject} does not balance: found ${record.found} but as_requirements ${record.as_requirements} + queued ${record.queued.length} = ${sum}`
    }
    return null
  }
  const sum = record.fixed + record.queued.length
  if (sum !== record.findings) {
    return `closer census for ${record.closer} does not balance: findings ${record.findings} but fixed ${record.fixed} + queued ${record.queued.length} = ${sum}`
  }
  return null
}

export function validateCensus(row: unknown): Validated<Census> {
  // A row must be a JSON object with a recognized kind before any field is
  // dereferenced. A null, a string, a number or an array must be rejected
  // cleanly here rather than throwing on the first property read.
  if (!isRecord(row)) return { ok: false, errors: ['census: row must be a JSON object'] }
  const errors: string[] = []
  const r = row
  const kind = r.kind
  const num = (k: string): number => {
    const v = r[k]
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
      errors.push(`census: ${k} must be a non-negative integer`)
      return 0
    }
    return v
  }
  const list = (k: string): unknown[] => {
    const v = r[k] ?? []
    if (!Array.isArray(v)) {
      errors.push(`census: ${k} must be an array`)
      return []
    }
    return v
  }
  const text = (k: string): string => {
    const v = r[k]
    if (typeof v !== 'string' || v.length === 0) {
      errors.push(`census: ${k} is required`)
      return ''
    }
    return v
  }

  if (kind === 'lens') {
    text('surface')
    text('phase')
    text('batch')
    num('total')
    num('in_ledger')
    num('added')
    list('skipped')
    list('queued')
  } else if (kind === 'attribute') {
    text('surface')
    text('subject')
    text('batch')
    num('total')
    num('behavioral')
    num('explained')
    list('queued')
  } else if (kind === 'rule-sweep') {
    text('subject')
    text('batch')
    num('probes')
    num('found')
    num('as_requirements')
    list('queued')
  } else if (kind === 'closer') {
    text('closer')
    text('batch')
    num('checked')
    num('findings')
    num('fixed')
    list('queued')
  } else {
    errors.push(`census: unknown kind ${String(kind)}`)
  }

  if (errors.length > 0) return { ok: false, errors }
  const record = row as Census
  const imbalance = balanceOf(record)
  if (imbalance) return { ok: false, errors: [imbalance] }
  return { ok: true, value: record }
}
