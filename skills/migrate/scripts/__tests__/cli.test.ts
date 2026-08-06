import { expect, test } from 'bun:test'
import { join } from 'node:path'

const CLI = join(import.meta.dir, '..', '..', 'bin', 'migrate.ts')

async function run(args: string[]): Promise<{ code: number; out: string; err: string }> {
  const proc = Bun.spawn(['bun', CLI, ...args], { stdout: 'pipe', stderr: 'pipe' })
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  await proc.exited
  return { code: proc.exitCode ?? -1, out, err }
}

test('--help exits 0 and lists the subcommands', async () => {
  const { code, out } = await run(['--help'])
  expect(code).toBe(0)
  for (const verb of ['init', 'import', 'census', 'queue', 'check', 'status', 'reset', 'report']) {
    expect(out).toContain(verb)
  }
})

test('no subcommand is a usage error', async () => {
  const { code, err } = await run([])
  expect(code).toBe(2)
  expect(err).toContain('Usage')
})

test('unknown subcommand is a usage error naming the input', async () => {
  const { code, err } = await run(['frobnicate'])
  expect(code).toBe(2)
  expect(err).toContain('frobnicate')
})

test('--version prints the package version', async () => {
  const { code, out } = await run(['--version'])
  expect(code).toBe(0)
  expect(out.trim()).toMatch(/^migrate \d+\.\d+\.\d+$/)
})
