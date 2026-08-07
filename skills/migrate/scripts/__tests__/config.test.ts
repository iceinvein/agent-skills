import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_CLOSERS, DEFAULT_SURFACES, loadConfig, writeConfig } from '../config.ts'
import { storePaths } from '../paths.ts'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'migrate-config-'))
  await mkdir(join(root, '.migrate'), { recursive: true })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const MINIMAL = `[source]
path = "/tmp/legacy"
scope = "the whole thing"
stack = "unknown"
vcs = "none"
basis = "source-only"

[target]
name = "newapp"
stack = "bun + react"
parity_test_path = "tests/parity/{capability}/{fr_slug}.test.ts"
`

test('loadConfig fills the default surface and closer sets', async () => {
  await writeFile(storePaths(root).config, MINIMAL)
  const cfg = await loadConfig(root)
  expect(cfg.surfaces).toEqual([...DEFAULT_SURFACES])
  expect(cfg.closers).toEqual([...DEFAULT_CLOSERS])
  expect(cfg.source.path).toBe('/tmp/legacy')
  expect(cfg.source.basis).toBe('source-only')
})

test('loadConfig honours a declared surface set', async () => {
  await writeFile(
    storePaths(root).config,
    `${MINIMAL}\n[surfaces]\ntypes = ["programs", "copybooks"]\nsingular = { copybooks = "copybook" }\n`,
  )
  const cfg = await loadConfig(root)
  expect(cfg.surfaces).toEqual(['programs', 'copybooks'])
  expect(cfg.surfaceSingular.copybooks).toBe('copybook')
})

test('loadConfig fails with a diagnostic when a required key is missing', async () => {
  await writeFile(storePaths(root).config, '[source]\npath = "/tmp/legacy"\n')
  await expect(loadConfig(root)).rejects.toThrow(/source.scope/)
})

test('loadConfig fails with a diagnostic when the file is absent', async () => {
  await expect(loadConfig(root)).rejects.toThrow(/config.toml/)
})

test('writeConfig then loadConfig round-trips', async () => {
  await writeConfig(root, {
    sourcePath: '/tmp/legacy',
    scope: 'billing only',
    targetName: 'newapp',
  })
  const cfg = await loadConfig(root)
  expect(cfg.source.scope).toBe('billing only')
  expect(cfg.target.name).toBe('newapp')
  expect(cfg.source.stack).toBe('unknown')
  expect(cfg.handoff.adapter).toBe('markdown')
})

// A hostile scope is operator-typed free text, not TOML syntax: writeConfig
// must escape it so loadConfig reads back the exact bytes that were passed in,
// rather than truncating the value, injecting a key, or leaving config.toml
// unparseable for every later command.
const HOSTILE_SCOPES: Array<[string, string]> = [
  ['a quote that would otherwise close the string and inject a key', 'billing" evil = true #'],
  ['a backslash that would otherwise start a TOML escape', 'billing\\team'],
  ['a newline that would otherwise leave the string unterminated', 'billing\nrogue'],
  ['a tab', 'billing\trogue'],
  ['several hostile characters combined', 'billing" \\evil\t\n#more'],
]

for (const [label, scope] of HOSTILE_SCOPES) {
  test(`writeConfig then loadConfig round-trips ${label} byte-identically`, async () => {
    await writeConfig(root, { sourcePath: '/tmp/legacy', scope, targetName: 'newapp' })
    const cfg = await loadConfig(root)
    expect(cfg.source.scope).toBe(scope)
  })
}

test('writeConfig round-trips a value containing backspace, form feed and delete', async () => {
  const scope = `billing${String.fromCharCode(0x08)}${String.fromCharCode(0x0c)}${String.fromCharCode(0x7f)}rogue`
  await writeConfig(root, { sourcePath: '/tmp/legacy', scope, targetName: 'newapp' })
  const cfg = await loadConfig(root)
  expect(cfg.source.scope).toBe(scope)
})

test('writeConfig refuses a value containing a control character it cannot represent', async () => {
  const scope = `billing${String.fromCharCode(0x1b)}esc`
  await expect(
    writeConfig(root, { sourcePath: '/tmp/legacy', scope, targetName: 'newapp' }),
  ).rejects.toThrow(/U\+001b/)
})

test('writeConfig does not fall prey to $-pattern replacement corruption', async () => {
  const scope = 'cost$&$$center'
  await writeConfig(root, { sourcePath: '/tmp/legacy', scope, targetName: 'newapp' })
  const cfg = await loadConfig(root)
  expect(cfg.source.scope).toBe(scope)
})
