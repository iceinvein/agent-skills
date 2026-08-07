import { existsSync } from 'node:fs'
import { balanceOf, boundsOf, censusKey, validateCensus } from './census.ts'
import { resolveCitations } from './citations.ts'
import { loadConfig } from './config.ts'
import { scanLeaks } from './leaks.ts'
import { storePaths } from './paths.ts'
import { loadPhases, PHASES, type Phase } from './phases.ts'
import { loadQueue } from './queue.ts'
import { readRawRows, readRows } from './store.ts'
import type { Capability, Census, Delta, Element, Requirement, Violation } from './types.ts'
import { isRecord } from './validate.ts'

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
  'run-state',
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
  phase?: Phase
}): Promise<CheckResult> {
  const cfg = await loadConfig(opts.root)
  const paths = storePaths(opts.root)
  const gitBin = opts.gitBin ?? 'git'

  const elements = await readRows<Element>(paths.elements)
  const requirements = await readRows<Requirement>(paths.requirements)
  const capabilities = await readRows<Capability>(paths.capabilities)
  const deltas = await readRows<Delta>(paths.deltas)
  // Read raw, not readRows<Census>: census.jsonl is the one store file this
  // gate cannot assume was ever written by census-cmd.ts, since nothing
  // stops a hand edit, and readRows only asserts a type onto whatever
  // JSON.parse returns rather than checking it. Gate 2 below runs the same
  // validateCensus every real write goes through, so a shape that only
  // TypeScript ever believed in gets caught here instead of quietly reaching
  // balanceOf and boundsOf, both of which assume a well-formed record.
  const censusRows = await readRawRows(paths.census)
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

  // Gate 2: census shape, balance and presence. Each row is validated here,
  // not merely read, because census.jsonl is a store file that census-cmd.ts
  // does not own exclusively: a hand edit reaches this gate without ever
  // passing through validateCensus first. A row that fails is named by line
  // (and by censusKey when its identity parses) and excluded from every
  // check below it: balanceOf and boundsOf both assume a well-formed
  // record, so running them on one that already failed shape validation
  // would add confusing noise on top of the real defect rather than a
  // second independent fact; and letting an invalid row still count as "this
  // surface has a census record" would hide the exact gap this gate exists
  // to close.
  const surfacesWithCensus = new Set<string>()
  const closersWithCensus = new Set<string>()
  const census: Census[] = []
  for (const { line, raw } of censusRows) {
    const result = validateCensus(raw)
    if (!result.ok) {
      const label = censusRowLabel(raw, line)
      for (const error of result.errors) {
        violations.push({ gate: 'census', message: `${label}: ${error}` })
      }
      continue
    }
    const record = result.value
    census.push(record)
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
      const actual = elements.filter((e) => e.surface === record.surface).length
      if (actual !== claimed) {
        violations.push({
          gate: 'census',
          message: `lens census for ${record.surface} claims in_ledger ${record.in_ledger} + added ${record.added} = ${claimed} element(s) in the ledger, but elements.jsonl has ${actual}`,
        })
      }
    }
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

  // Gate 7: citations. Citations are on unless explicitly disabled. An FR
  // citing a path that does not exist is the never-fabricate rule's only
  // mechanical expression, so it should not be something a run has to
  // remember to ask for.
  if (opts.citations !== false) {
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

  // Gate 10: run-state. Every other gate proves the store is internally
  // consistent, which an empty store satisfies. This one asks whether the run
  // that was supposed to fill it actually happened, which is the only reason
  // exit 0 can mean "complete" rather than "nothing contradicts anything".
  const phases = await loadPhases(opts.root)
  const terminus = opts.phase ? PHASES.indexOf(opts.phase) : PHASES.length - 1
  const terminusName = PHASES[terminus]
  for (let i = 0; i <= terminus; i++) {
    const p = PHASES[i]
    if (!p) continue
    const status = phases[p].status
    if (status !== 'done') {
      violations.push({
        gate: 'run-state',
        message: `phase ${p} is ${status}; every phase through ${terminusName} must be done`,
      })
    }
  }
  // Checked across all eight phases, not just up to the terminus: a later
  // phase marked done over a pending predecessor is hand-edited state, and it
  // is worth naming whether or not the caller asked about that phase.
  for (let i = 1; i < PHASES.length; i++) {
    const current = PHASES[i]
    const previous = PHASES[i - 1]
    if (!current || !previous) continue
    if (phases[current].status === 'done' && phases[previous].status === 'pending') {
      violations.push({
        gate: 'run-state',
        message: `phase ${current} is done while ${previous} is still pending`,
      })
    }
  }
  // A census record naming a batch phases.json never committed means the two
  // disagree about what happened. Only checked when the record exists, since
  // gate 2 already names a declared surface or closer that has none.
  const committedIn = (phase: Phase): Set<string> => new Set(phases[phase].batches.map((b) => b.id))
  const enumerateBatches = committedIn('enumerate')
  for (const surface of cfg.surfaces) {
    const record = census.find((r) => r.kind === 'lens' && r.surface === surface)
    if (record && !enumerateBatches.has(record.batch)) {
      violations.push({
        gate: 'run-state',
        message: `lens census for ${surface} names batch ${record.batch}, which phases.json has no record of committing in enumerate`,
      })
    }
  }
  const extractBatches = committedIn('extract')
  for (const closer of cfg.closers) {
    const record = census.find((r) => r.kind === 'closer' && r.closer === closer)
    if (record && !extractBatches.has(record.batch)) {
      violations.push({
        gate: 'run-state',
        message: `closer census for ${closer} names batch ${record.batch}, which phases.json has no record of committing in extract`,
      })
    }
  }

  const order = new Map(GATE_ORDER.map((g, i) => [g as string, i]))
  violations.sort((a, b) => (order.get(a.gate) ?? 99) - (order.get(b.gate) ?? 99))

  return { summary, violations }
}
