import type { Violation } from '../types.ts'
import type { Gate } from './context.ts'

// Escapes every regex metacharacter so the template's literal text (the dots
// in `.test.ts`, above all) matches only itself.
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// The template a requirement's executable parity ref must instantiate.
// `{capability}` is fixed by the requirement's own `cap`; `{fr_slug}` is
// chosen by hand (parity.md), so only its kebab-case shape can be checked.
function parityRefPattern(template: string, capability: string): RegExp {
  const body = template
    .split('{fr_slug}')
    .map((part) => part.split('{capability}').map(escapeRegex).join(escapeRegex(capability)))
    .join('[a-z0-9]+(?:-[a-z0-9]+)*')
  return new RegExp(`^${body}$`)
}

// Gate 6: parity coverage. A requirement whose confidence is `queued` is
// waiting on an owner decision, so it is not yet expected to carry a parity
// plan; every other requirement is.
export const gate: Gate = (ctx): Violation[] => {
  const violations: Violation[] = []
  for (const req of ctx.requirements) {
    if (req.confidence.kind !== 'queued' && req.parity === null) {
      violations.push({ gate: 'parity', message: `${req.id} has no parity plan` })
    }
    // A golden-master or differential plan names the test file that will run
    // it. A ref off the template is a test the target's parity suite will not
    // find where handoff tells the builder to put it.
    if (req.parity?.kind === 'golden-master' || req.parity?.kind === 'differential') {
      const template = ctx.cfg.target.parity_test_path
      if (!parityRefPattern(template, req.cap).test(req.parity.ref)) {
        violations.push({
          gate: 'parity',
          message: `${req.id} parity ref ${req.parity.ref} does not match parity_test_path ${template}`,
        })
      }
    }
  }
  return violations
}
