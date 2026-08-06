import { isValidSlug } from './ids.ts'
import type { Census, Skipped } from './types.ts'
import type { Validated } from './validate.ts'
import { isRecord } from './validate.ts'

const QUEUE_PREFIX = 'q-'

// A queue id is q- followed by a lowercase kebab-case slug (ids.ts's own
// shape, reused rather than a second regex). This is deliberately a format
// constraint, not a blocklist of specific cosmetic defects: an uppercase
// letter, a stray space, or trailing punctuation are all rejected because
// none of them produces a well-formed slug, not because each was chased
// down individually.
function isValidQueueId(s: string): boolean {
  return s.startsWith(QUEUE_PREFIX) && isValidSlug(s.slice(QUEUE_PREFIX.length))
}

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
  // cleanly here rather than throwing on the first property read. Messages
  // here carry no 'census: ' prefix of their own: the call site owns that
  // prefix, so callers never have to strip or double it.
  if (!isRecord(row)) return { ok: false, errors: ['row must be a JSON object'] }
  const errors: string[] = []
  const r = row
  const kind = r.kind
  const num = (k: string): number => {
    const v = r[k]
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
      errors.push(`${k} must be a non-negative integer`)
      return 0
    }
    return v
  }
  const text = (k: string): string => {
    const v = r[k]
    if (typeof v !== 'string' || v.length === 0) {
      errors.push(`${k} is required`)
      return ''
    }
    return v
  }
  // Every queued entry must be a well-formed queue id, not merely a
  // non-empty string: a bare id-shaped check let a duplicate survive under a
  // cosmetic disguise (different case, a trailing space, trailing
  // punctuation), each one still counted toward .length by balanceOf. The
  // format constraint closes that as a class rather than chasing variants.
  // Trimmed before validating, and an entry that only becomes valid after
  // trimming is rejected rather than silently accepted with the whitespace
  // dropped: the point is that a stray space fails cleanly, not that it gets
  // normalized away. The uniqueness check below then compares the one
  // canonical (already trim-equal) value every accepted entry has.
  const queuedList = (k: string): string[] => {
    const v = r[k] ?? []
    if (!Array.isArray(v)) {
      errors.push(`${k} must be an array`)
      return []
    }
    const out: string[] = []
    v.forEach((item, i) => {
      const trimmed = typeof item === 'string' ? item.trim() : ''
      if (typeof item !== 'string' || trimmed !== item || !isValidQueueId(trimmed)) {
        errors.push(`${k}[${i}] must be a valid queue id: q- followed by a lowercase slug`)
        return
      }
      out.push(trimmed)
    })
    const seen = new Map<string, number>()
    for (const id of out) seen.set(id, (seen.get(id) ?? 0) + 1)
    for (const [id, count] of seen) {
      if (count > 1) errors.push(`${k} id ${id} appears ${count} times`)
    }
    return out
  }
  // Every skipped entry must be an object naming a non-empty element and a
  // non-empty reason. A repeated element is the same padding risk as a
  // repeated queued id, and is rejected on the element alone (not full
  // struct equality) so varying the reason text cannot evade the check.
  const skippedList = (k: string): Skipped[] => {
    const v = r[k] ?? []
    if (!Array.isArray(v)) {
      errors.push(`${k} must be an array`)
      return []
    }
    const out: Skipped[] = []
    v.forEach((item, i) => {
      const element = isRecord(item) ? item.element : undefined
      const reason = isRecord(item) ? item.reason : undefined
      const valid =
        typeof element === 'string' &&
        element.length > 0 &&
        typeof reason === 'string' &&
        reason.length > 0
      if (!valid) {
        errors.push(`${k}[${i}] must be an object with a non-empty element and reason`)
        return
      }
      out.push({ element, reason })
    })
    const seen = new Map<string, number>()
    for (const s of out) seen.set(s.element, (seen.get(s.element) ?? 0) + 1)
    for (const [element, count] of seen) {
      if (count > 1) errors.push(`${k} element ${element} appears ${count} times`)
    }
    return out
  }

  if (kind === 'lens') {
    text('surface')
    text('phase')
    text('batch')
    num('total')
    num('in_ledger')
    num('added')
    const skipped = skippedList('skipped')
    const queued = queuedList('queued')
    // queued ids and skipped element names are different namespaces (a
    // queue id must be q-<slug>; an element name is unconstrained free text
    // drawn from the legacy system), so nothing stops a skipped element from
    // coincidentally, or deliberately, matching a queued id's exact text.
    // Checked explicitly: see the report for why this earns its keep rather
    // than being left to the format constraint alone.
    const queuedSet = new Set(queued)
    for (const s of skipped) {
      if (queuedSet.has(s.element)) {
        errors.push(`${s.element} appears in both skipped and queued`)
      }
    }
  } else if (kind === 'attribute') {
    text('surface')
    text('subject')
    text('batch')
    num('total')
    num('behavioral')
    num('explained')
    queuedList('queued')
  } else if (kind === 'rule-sweep') {
    text('subject')
    text('batch')
    num('probes')
    num('found')
    num('as_requirements')
    queuedList('queued')
  } else if (kind === 'closer') {
    text('closer')
    text('batch')
    num('checked')
    num('findings')
    num('fixed')
    queuedList('queued')
  } else {
    errors.push(`unknown kind ${String(kind)}`)
  }

  if (errors.length > 0) return { ok: false, errors }
  const record = row as Census
  return { ok: true, value: record }
}
