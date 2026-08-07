import { expect, test } from 'bun:test'
import { namespaceId, parseFindingsFilename } from '../findings-files.ts'

test('parseFindingsFilename reads an unsharded focus file', () => {
  expect(parseFindingsFilename('security.json')).toEqual({ focus: 'security', shard: null })
  expect(parseFindingsFilename('code-smells.json')).toEqual({ focus: 'code-smells', shard: null })
})

test('parseFindingsFilename reads a sharded focus file', () => {
  expect(parseFindingsFilename('security.shard-2.json')).toEqual({ focus: 'security', shard: 2 })
  expect(parseFindingsFilename('architecture.shard-11.json')).toEqual({
    focus: 'architecture',
    shard: 11,
  })
})

test('parseFindingsFilename rejects names it cannot read', () => {
  expect(parseFindingsFilename('notes.txt')).toBeNull()
  expect(parseFindingsFilename('security.shard-x.json')).toBeNull()
  expect(parseFindingsFilename('security.shard-2.extra.json')).toBeNull()
  expect(parseFindingsFilename('.json')).toBeNull()
})

test('namespaceId leaves unsharded ids alone', () => {
  expect(namespaceId('security-1', 'security', null)).toBe('security-1')
})

test('namespaceId inserts the shard tag after the focus prefix', () => {
  expect(namespaceId('security-1', 'security', 2)).toBe('security-s2-1')
  expect(namespaceId('code-smells-7', 'code-smells', 3)).toBe('code-smells-s3-7')
})

test('namespaceId prefixes ids that do not carry the focus', () => {
  expect(namespaceId('finding-1', 'security', 2)).toBe('s2-finding-1')
})
