import { expect, test } from 'bun:test'
import { idPrefixFor, isValidSlug, singularOf, validateElementId } from '../ids.ts'

test('singularOf strips a trailing s', () => {
  expect(singularOf('routes', {})).toBe('route')
  expect(singularOf('tables', {})).toBe('table')
  expect(singularOf('jcl-jobs', {})).toBe('jcl-job')
})

test('singularOf leaves a word with no trailing s alone', () => {
  expect(singularOf('data', {})).toBe('data')
})

test('singularOf prefers an explicit override', () => {
  expect(singularOf('indices', { indices: 'index' })).toBe('index')
})

test('isValidSlug accepts lowercase kebab and digits, rejects the rest', () => {
  expect(isValidSlug('get-api-users')).toBe(true)
  expect(isValidSlug('roster-days-2')).toBe(true)
  expect(isValidSlug('Get-Api')).toBe(false)
  expect(isValidSlug('get_api')).toBe(false)
  expect(isValidSlug('')).toBe(false)
  expect(isValidSlug('-leading')).toBe(false)
})

test('validateElementId requires the surface prefix', () => {
  expect(validateElementId('route-get-api-users', 'routes', {})).toBeNull()
  expect(validateElementId('table-users', 'routes', {})).toContain('route-')
})

test('validateElementId rejects a bad slug after a good prefix', () => {
  expect(validateElementId('route-Get_Api', 'routes', {})).toContain('slug')
})

test('idPrefixFor is the singular plus a hyphen', () => {
  expect(idPrefixFor('integrations', {})).toBe('integration-')
})
