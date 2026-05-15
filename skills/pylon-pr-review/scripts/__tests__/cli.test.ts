import { expect, test } from 'bun:test'

const CLI = new URL('../../bin/pr-review.ts', import.meta.url).pathname

test('unknown subcommand exits non-zero with usage', async () => {
  const proc = Bun.spawn(['bun', CLI, 'wat'], { stderr: 'pipe', stdout: 'pipe' })
  const exit = await proc.exited
  const stderr = await new Response(proc.stderr).text()
  expect(exit).not.toBe(0)
  expect(stderr).toContain('Unknown subcommand: wat')
  expect(stderr).toContain('Usage: pr-review <subcommand>')
})

test('no subcommand exits non-zero with usage', async () => {
  const proc = Bun.spawn(['bun', CLI], { stderr: 'pipe' })
  const exit = await proc.exited
  const stderr = await new Response(proc.stderr).text()
  expect(exit).not.toBe(0)
  expect(stderr).toContain('Usage: pr-review <subcommand>')
})

test('--help prints usage and exits 0', async () => {
  const proc = Bun.spawn(['bun', CLI, '--help'], { stdout: 'pipe' })
  const exit = await proc.exited
  const stdout = await new Response(proc.stdout).text()
  expect(exit).toBe(0)
  expect(stdout).toContain('Usage: pr-review <subcommand>')
})
