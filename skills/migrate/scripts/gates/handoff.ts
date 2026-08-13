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
  const handoff = ctx.handoff
  if (!handoff) {
    return [
      {
        gate: 'handoff',
        message:
          'no handoff.json in the store; handoff has not run, so nothing has reached a delivery medium',
      },
    ]
  }

  const known = new Set(ctx.requirements.map((r) => r.id))
  const keys = new Set(handoff.items.map((i) => i.key))
  const emittedIds = new Set<string>()

  for (const item of handoff.items) {
    for (const fr of item.frs) {
      emittedIds.add(fr)
      if (!known.has(fr)) {
        violations.push({
          gate: 'handoff',
          message: `work item ${item.key} names requirement ${fr}, which is not in the registry`,
        })
      }
    }
    for (const dep of item.dependsOn) {
      if (!keys.has(dep)) {
        violations.push({
          gate: 'handoff',
          message: `work item ${item.key} depends on ${dep}, which is not a work item`,
        })
      }
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
