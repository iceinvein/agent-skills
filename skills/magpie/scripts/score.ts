import type { Action, Confidence, Impact, Likelihood, Risk } from './types.ts'

const IMPACT_WEIGHT: Record<Impact, number> = {
  critical: 10,
  high: 7,
  medium: 4,
  low: 1,
}

const LIKELIHOOD_WEIGHT: Record<Likelihood, number> = {
  likely: 10,
  possible: 6,
  'edge-case': 3,
  unknown: 4,
}

const CONFIDENCE_WEIGHT: Record<Confidence, number> = {
  high: 10,
  medium: 5,
  low: 2,
}

const ACTION_WEIGHT: Record<Action, number> = {
  'must-fix': 10,
  'should-fix': 7,
  consider: 4,
  optional: 1,
}

export const DEFAULT_THRESHOLD = 3

export function scoreRisk(risk: Risk): number {
  const raw =
    IMPACT_WEIGHT[risk.impact] * 0.4 +
    LIKELIHOOD_WEIGHT[risk.likelihood] * 0.25 +
    CONFIDENCE_WEIGHT[risk.confidence] * 0.2 +
    ACTION_WEIGHT[risk.action] * 0.15
  return Math.round(raw * 10) / 10
}
