import { expect, test } from 'bun:test'
import { preflight } from '../preflight.ts'

test('returns ok when all binaries resolve', async () => {
  const result = await preflight({
    bun: 'bun',
    gh: 'echo',
    codex: 'echo',
    git: 'git',
  })
  expect(result.ok).toBe(true)
  expect(result.missing).toEqual([])
  expect(result.missingOptional).toEqual([])
})

test('returns missing list when required binaries do not resolve', async () => {
  const result = await preflight({
    bun: 'bun',
    gh: 'definitely-not-a-binary-xyz123',
    codex: 'echo',
    git: 'git',
  })
  expect(result.ok).toBe(false)
  expect(result.missing).toContain('gh')
})

test('missing codex is optional and does not abort the run', async () => {
  const result = await preflight({
    bun: 'bun',
    gh: 'echo',
    codex: 'also-not-real-abc456',
    git: 'git',
  })
  expect(result.ok).toBe(true)
  expect(result.missing).not.toContain('codex')
  expect(result.missingOptional).toContain('codex')
})

test('renderInstallHint produces a single-line message per missing tool', () => {
  const { renderInstallHint } = require('../preflight.ts')
  const out = renderInstallHint(['gh', 'codex'])
  expect(out).toContain('gh:')
  expect(out).toContain('codex:')
  expect(out.split('\n').length).toBeGreaterThanOrEqual(2)
})
