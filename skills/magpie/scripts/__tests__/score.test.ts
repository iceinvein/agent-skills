import { expect, test } from 'bun:test'
import { DEFAULT_THRESHOLD, scoreRisk } from '../score.ts'
import type { Risk } from '../types.ts'

const risk = (over: Partial<Risk> = {}): Risk => ({
  impact: 'medium',
  likelihood: 'possible',
  confidence: 'medium',
  action: 'should-fix',
  ...over,
})

test('scoreRisk: maxed-out risk hits ~10', () => {
  const s = scoreRisk({
    impact: 'critical',
    likelihood: 'likely',
    confidence: 'high',
    action: 'must-fix',
  })
  expect(s).toBeCloseTo(10, 1)
})

test('scoreRisk: floor risk is near 1', () => {
  const s = scoreRisk({
    impact: 'low',
    likelihood: 'edge-case',
    confidence: 'low',
    action: 'optional',
  })
  expect(s).toBeGreaterThanOrEqual(1)
  expect(s).toBeLessThan(2.5)
})

test('scoreRisk: impact dominates over action', () => {
  const highImpact = scoreRisk(risk({ impact: 'critical', action: 'optional' }))
  const lowImpact = scoreRisk(risk({ impact: 'low', action: 'must-fix' }))
  expect(highImpact).toBeGreaterThan(lowImpact)
})

test('scoreRisk: confidence pulls weight', () => {
  const highConf = scoreRisk(risk({ confidence: 'high' }))
  const lowConf = scoreRisk(risk({ confidence: 'low' }))
  expect(highConf - lowConf).toBeGreaterThan(0.5)
})

test('DEFAULT_THRESHOLD is sensible (drops floor, keeps medium)', () => {
  expect(DEFAULT_THRESHOLD).toBeGreaterThan(0)
  expect(DEFAULT_THRESHOLD).toBeLessThan(5)
  const medium = scoreRisk(risk())
  expect(medium).toBeGreaterThanOrEqual(DEFAULT_THRESHOLD)
})
