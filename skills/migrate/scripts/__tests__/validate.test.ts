import { expect, test } from 'bun:test'
import type { Config } from '../config.ts'
import { validateDelta, validateElement, validateRequirement } from '../validate.ts'

const CFG: Config = {
  source: {
    path: '/tmp/legacy',
    scope: 'all',
    stack: 'unknown',
    vcs: 'none',
    basis: 'source-only',
  },
  target: { name: 'newapp', stack: 'unknown', parity_test_path: 'x', layout: {}, commands: {} },
  surfaces: ['routes'],
  surfaceSingular: {},
  closers: [],
  handoff: { adapter: 'markdown' },
}

test('validateElement rejects a null row instead of throwing', () => {
  const result = validateElement(null, CFG)
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.errors.join(' ')).toContain('object')
})

test('validateElement rejects a non-object row instead of throwing', () => {
  const result = validateElement('not a row', CFG)
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.errors.join(' ')).toContain('object')
})

test('validateRequirement rejects a null row instead of throwing', () => {
  const result = validateRequirement(null, CFG)
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.errors.join(' ')).toContain('object')
})

test('validateRequirement rejects a non-object row instead of throwing', () => {
  const result = validateRequirement(42, CFG)
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.errors.join(' ')).toContain('object')
})

test('validateDelta rejects a null row instead of throwing', () => {
  const result = validateDelta(null, CFG)
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.errors.join(' ')).toContain('object')
})

test('validateDelta rejects a non-object row instead of throwing', () => {
  const result = validateDelta(['not', 'a', 'row'], CFG)
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.errors.join(' ')).toContain('object')
})
