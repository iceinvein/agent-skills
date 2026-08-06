import { afterEach, beforeEach, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '../config.ts'
import { runInit } from '../init-cmd.ts'
import { storePaths } from '../paths.ts'

let root: string
let source: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'migrate-init-'))
  source = join(root, 'legacy')
  await mkdir(source, { recursive: true })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const BASE = () => ({ root, sourcePath: source, scope: 'billing', targetName: 'newapp' })

test('init creates the store and a loadable config', async () => {
  expect(await runInit(BASE())).toBe(0)
  expect(existsSync(storePaths(root).queueDir)).toBe(true)
  const cfg = await loadConfig(root)
  expect(cfg.source.scope).toBe('billing')
  expect(cfg.target.name).toBe('newapp')
})

test('init refuses to overwrite an existing config', async () => {
  await runInit(BASE())
  expect(await runInit(BASE())).toBe(1)
})

test('init refuses a source path that does not exist', async () => {
  expect(await runInit({ ...BASE(), sourcePath: join(root, 'nope') })).toBe(2)
})

test('init appends the env file to an existing .gitignore exactly once', async () => {
  await writeFile(join(root, '.gitignore'), 'node_modules/\n')
  await runInit(BASE())
  const text = await readFile(join(root, '.gitignore'), 'utf8')
  expect(text).toContain('.migrate/.env')
  expect(text.match(/\.migrate\/\.env/g)).toHaveLength(1)
})

test('init records an explicit basis', async () => {
  await runInit({ ...BASE(), basis: 'runnable' })
  expect((await loadConfig(root)).source.basis).toBe('runnable')
})

test('init appends the env file to a .gitignore that lacks a trailing newline', async () => {
  await writeFile(join(root, '.gitignore'), 'node_modules/')
  await runInit(BASE())
  const text = await readFile(join(root, '.gitignore'), 'utf8')
  expect(text).toBe('node_modules/\n.migrate/.env\n')
})

test('init detects vcs as git when the source path contains a .git directory', async () => {
  await mkdir(join(source, '.git'), { recursive: true })
  await runInit(BASE())
  expect((await loadConfig(root)).source.vcs).toBe('git')
})

test('init detects vcs as none when the source path has no .git directory', async () => {
  await runInit(BASE())
  expect((await loadConfig(root)).source.vcs).toBe('none')
})
