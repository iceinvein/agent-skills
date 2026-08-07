import { afterEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { errorMessage } from '../../bin/migrate.ts'

const CLI = join(import.meta.dir, '..', '..', 'bin', 'migrate.ts')

async function run(
  args: string[],
  opts: { cwd?: string } = {},
): Promise<{ code: number; out: string; err: string }> {
  const proc = Bun.spawn(['bun', CLI, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
  })
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

// The central guard in main() (bin/migrate.ts): every handler calls
// loadConfig without a try/catch of its own, so a missing or malformed
// config.toml throws an Error that none of them classifies. Before the
// guard, that Error escaped as a raw Bun stack trace (source snippet, "at
// ..." frames, a non-deliberate exit code). The guard must turn that into
// the same one-line, no-stack-trace diagnostic every handler already
// produces for its own recognized failures, with a deliberate exit code:
// 2, because the request could not be serviced at all (same class as "no
// .migrate store found above the cwd"), not 1 (a well-formed request with
// a bad answer).

let guardRoot: string | undefined

afterEach(async () => {
  if (guardRoot) await rm(guardRoot, { recursive: true, force: true })
  guardRoot = undefined
})

function looksLikeStackTrace(text: string): boolean {
  return /\bat\s+\S+\s*\(?.*:\d+:\d+/.test(text) || text.includes('Bun v') || text.includes('^')
}

test('a missing config.toml is a clean diagnostic and exit 2, not a stack trace', async () => {
  guardRoot = await realpath(await mkdtemp(join(tmpdir(), 'migrate-cli-guard-')))
  await mkdir(join(guardRoot, '.migrate'), { recursive: true })
  const { code, out, err } = await run(['check'], { cwd: guardRoot })
  expect(code).toBe(2)
  expect(out).toBe('')
  expect(err).toBe(
    `check: config.toml not found at ${join(guardRoot, '.migrate', 'config.toml')}; run 'migrate init' first\n`,
  )
  expect(looksLikeStackTrace(err)).toBe(false)
})

test('a malformed config.toml is a clean diagnostic and exit 2, not a stack trace', async () => {
  guardRoot = await realpath(await mkdtemp(join(tmpdir(), 'migrate-cli-guard-')))
  await mkdir(join(guardRoot, '.migrate'), { recursive: true })
  await writeFile(join(guardRoot, '.migrate', 'config.toml'), '[source]\npath = "/tmp/legacy"\n')
  const { code, err } = await run(['check'], { cwd: guardRoot })
  expect(code).toBe(2)
  expect(err).toBe('check: config.toml: missing or empty source.scope\n')
  expect(looksLikeStackTrace(err)).toBe(false)
})

test('the guard is central: it also catches a bad config.toml for queue, not just check', async () => {
  guardRoot = await realpath(await mkdtemp(join(tmpdir(), 'migrate-cli-guard-')))
  await mkdir(join(guardRoot, '.migrate'), { recursive: true })
  const { code, err } = await run(['queue', 'list'], { cwd: guardRoot })
  expect(code).toBe(2)
  expect(err).toContain('queue: config.toml not found')
  expect(looksLikeStackTrace(err)).toBe(false)
})

test("the guard does not mask a well-formed request's own classified failure", async () => {
  guardRoot = await realpath(await mkdtemp(join(tmpdir(), 'migrate-cli-guard-')))
  const { code, err } = await run(['import', 'elements', 'nope.json'], { cwd: guardRoot })
  // No .migrate store at all: findStoreRoot's own usage error fires before
  // loadConfig is ever reached, so this exercises the pre-existing guard
  // (findStoreRoot), not the new one, confirming the new guard did not
  // change behaviour for a case already handled.
  expect(code).toBe(2)
  expect(err).toContain('import: no .migrate store found above the cwd')
})

// Minor finding 5: init, report and reset each parse a `--flag <value>`
// pair, and used to disagree on what happens when the value slot is empty
// or is itself another flag. `init --scope --name newapp` used to read
// scope as the literal string '--name' and exit 0; `report --out` with
// nothing after it used to fall back to the default directory in silence;
// only `reset --phase` with no value at all was already a usage error. All
// three now share one rule, reset's own shape: either shape of a bad value
// is a usage error (2) naming the flag.

test('init treats a flag value that is itself another flag as a usage error, not a swallowed value', async () => {
  guardRoot = await realpath(await mkdtemp(join(tmpdir(), 'migrate-cli-flags-')))
  const { code, err } = await run(['init', '--source', guardRoot, '--scope', '--name', 'newapp'], {
    cwd: guardRoot,
  })
  expect(code).toBe(2)
  expect(err).toContain('--scope needs a value')
})

test('report --out with no value is a usage error, not a silent fallback to the default directory', async () => {
  guardRoot = await realpath(await mkdtemp(join(tmpdir(), 'migrate-cli-flags-')))
  const { code, err } = await run(['report', '--out'], { cwd: guardRoot })
  expect(code).toBe(2)
  expect(err).toContain('--out needs a value')
})

test('reset --phase whose value is itself another flag is a usage error, matching a missing value', async () => {
  guardRoot = await realpath(await mkdtemp(join(tmpdir(), 'migrate-cli-flags-')))
  const { code, err } = await run(['reset', '--phase', '--out'], { cwd: guardRoot })
  expect(code).toBe(2)
  expect(err).toContain('--phase needs a value')
})

test('reset --phase with no value at all is still a usage error (unchanged)', async () => {
  guardRoot = await realpath(await mkdtemp(join(tmpdir(), 'migrate-cli-flags-')))
  const { code, err } = await run(['reset', '--phase'], { cwd: guardRoot })
  expect(code).toBe(2)
  expect(err).toContain('--phase needs a value')
})

test('reset with no --phase flag at all is a usage error naming the missing flag', async () => {
  guardRoot = await realpath(await mkdtemp(join(tmpdir(), 'migrate-cli-flags-')))
  const { code, err } = await run(['reset'], { cwd: guardRoot })
  expect(code).toBe(2)
  expect(err).toContain('missing --phase')
})

// Minor finding 6: the central guard's `(e as Error).message` printed the
// useless "sub: undefined" for a non-Error rejection, and would have thrown
// a TypeError from inside the catch itself for a rejected `null` or
// `undefined` -- the one shape that would still have escaped uncaught.
// `errorMessage` is the exact expression the guard now calls; exercised
// directly here since nothing in this CLI's own handlers currently rejects
// with anything but a real Error, so the failure mode this closes cannot
// be reproduced by driving the CLI end-to-end.

test('errorMessage returns the message of an Error instance', () => {
  expect(errorMessage(new Error('boom'))).toBe('boom')
})

test('errorMessage converts a non-Error rejection to a string instead of printing undefined', () => {
  expect(errorMessage('boom')).toBe('boom')
  expect(errorMessage({ code: 'EBOOM' })).toBe('[object Object]')
})

test('errorMessage converts a null or undefined rejection without throwing a second error', () => {
  expect(errorMessage(null)).toBe('null')
  expect(errorMessage(undefined)).toBe('undefined')
})
