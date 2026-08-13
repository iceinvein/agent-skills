import type { Violation } from '../types.ts'
import type { Gate } from './context.ts'

// Gate 12: handoff. Whether the ratified requirements actually reached the
// emitted work.
//
// This is what stops a plain `migrate check` from meaning no more than "the
// phases are marked done". Every other gate proves the store is internally
// consistent about phases 0 through 5, and gate 10 asks whether the run
// happened; without this one, a store could pass with handoff.json absent and
// nothing emitted anywhere at all.
//
// The honest limit is the same in kind as gate 10's. This proves the emitted
// work covers the store's requirements. It cannot prove the issues were read
// or the roadmap was believed.
export const gate: Gate = (ctx): Violation[] => {
  const violations: Violation[] = []
  const loaded = ctx.handoff
  if (!loaded || loaded.kind === 'absent') {
    return [
      {
        gate: 'handoff',
        message:
          'no handoff.json in the store; handoff has not run, so nothing has reached a delivery medium',
      },
    ]
  }
  if (loaded.kind === 'invalid') {
    // A present-but-unusable file is a different fact from an absent one, and
    // saying "handoff has not run" about a file that exists would send an
    // operator to re-run the command rather than to look at what is in it.
    return loaded.errors.map((e) => ({
      gate: 'handoff',
      message: `handoff.json ${e}`,
    }))
  }
  const handoff = loaded.value

  const known = new Set(ctx.requirements.map((r) => r.id))
  const keys = new Set(handoff.items.map((i) => i.key))
  const emittedIds = new Set<string>()
  const seenKeys = new Set<string>()
  const seenFrs = new Set<string>()

  for (const item of handoff.items) {
    // Two work items under one key make `refs`, `dependsOn` and the coverage
    // order all ambiguous, and a Set of keys hides the collision from every
    // check below it.
    if (seenKeys.has(item.key)) {
      violations.push({
        gate: 'handoff',
        message: `work item key ${item.key} appears more than once`,
      })
    }
    seenKeys.add(item.key)
    if (handoff.refs[item.key] === undefined) {
      // `refs` is the only evidence in this file that anything actually
      // reached the medium; every adapter writes one entry per item.
      violations.push({
        gate: 'handoff',
        message: `work item ${item.key} has no entry in refs, so nothing records where it was emitted`,
      })
    }
    for (const fr of item.frs) {
      if (seenFrs.has(fr)) {
        // The emitted count is a sum over frs lengths while membership is a
        // set, so without this one requirement in two work items satisfies
        // both and is delivered twice.
        violations.push({
          gate: 'handoff',
          message: `requirement ${fr} appears in more than one work item`,
        })
      }
      seenFrs.add(fr)
      emittedIds.add(fr)
      if (!known.has(fr)) {
        violations.push({
          gate: 'handoff',
          message: `work item ${item.key} names requirement ${fr}, which is not in the registry`,
        })
      }
    }
    for (const dep of item.dependsOn) {
      if (dep === item.key) {
        violations.push({
          gate: 'handoff',
          message: `work item ${item.key} depends on itself`,
        })
      } else if (!keys.has(dep)) {
        violations.push({
          gate: 'handoff',
          message: `work item ${item.key} depends on ${dep}, which is not a work item`,
        })
      }
    }
  }

  // basis.order drives coverage's whole per-capability walk, so an order that
  // does not match the emitted items makes coverage report a denominator
  // narrower than the store without saying so.
  for (const slug of handoff.basis.order) {
    if (!keys.has(slug)) {
      violations.push({
        gate: 'handoff',
        message: `handoff basis order names ${slug}, which is not a work item`,
      })
    }
  }
  for (const key of keys) {
    if (!handoff.basis.order.includes(key)) {
      violations.push({
        gate: 'handoff',
        message: `work item ${key} is missing from the handoff basis order, so coverage would not count it`,
      })
    }
  }

  // Every requirement, not only the confirmed ones. An inferred requirement is
  // something the build team must see and decide about, so handoff emits it;
  // confidence starts mattering at the coverage denominator, not here.
  for (const r of ctx.requirements) {
    if (!emittedIds.has(r.id)) {
      violations.push({
        gate: 'handoff',
        message: `${r.id} appears in no work item; re-run migrate handoff after the store changed`,
      })
    }
  }

  const confirmed = ctx.requirements.filter((r) => r.confidence.kind === 'confirmed').length
  if (handoff.basis.confirmed !== confirmed) {
    violations.push({
      gate: 'handoff',
      message: `handoff basis records ${handoff.basis.confirmed} confirmed requirement(s), but the store has ${confirmed}`,
    })
  }
  const emitted = handoff.items.reduce((n, i) => n + i.frs.length, 0)
  if (handoff.basis.emitted !== emitted) {
    violations.push({
      gate: 'handoff',
      message: `handoff basis records ${handoff.basis.emitted} emitted requirement(s), but its work items carry ${emitted}`,
    })
  }
  return violations
}
