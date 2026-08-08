import { afterEach, beforeEach, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '../config.ts'
import { runInit } from '../init-cmd.ts'
import { storePaths } from '../paths.ts'

async function captureStdout(fn: () => Promise<number>): Promise<{ code: number; text: string }> {
  const out: string[] = []
  const original = process.stdout.write.bind(process.stdout)
  process.stdout.write = ((s: string) => {
    out.push(s)
    return true
  }) as typeof process.stdout.write
  try {
    const code = await fn()
    return { code, text: out.join('') }
  } finally {
    process.stdout.write = original
  }
}

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

test('init refuses a source path that is a file, not a directory', async () => {
  const filePath = join(root, 'not-a-dir.txt')
  await writeFile(filePath, 'hi')
  expect(await runInit({ ...BASE(), sourcePath: filePath })).toBe(2)
})

test('init does not mistake an unrelated deeper path for a real .gitignore entry', async () => {
  await writeFile(join(root, '.gitignore'), 'node_modules/\nfoo/.migrate/.env\n')
  await runInit(BASE())
  const text = await readFile(join(root, '.gitignore'), 'utf8')
  const lines = text.split('\n').map((l) => l.trim())
  expect(lines).toContain('.migrate/.env')
  expect(lines.filter((l) => l === '.migrate/.env')).toHaveLength(1)
})

test('init does not mistake a commented-out mention for a real .gitignore entry', async () => {
  await writeFile(join(root, '.gitignore'), 'node_modules/\n# .migrate/.env (handled elsewhere)\n')
  await runInit(BASE())
  const text = await readFile(join(root, '.gitignore'), 'utf8')
  const lines = text.split('\n').map((l) => l.trim())
  expect(lines).toContain('.migrate/.env')
  expect(lines.filter((l) => l === '.migrate/.env')).toHaveLength(1)
})

// Final-review finding, Important 1: init was the one writer with no
// containment guard. `migrate init --source .` inside a source tree created
// config.toml, made queue/, and appended to the source's own .gitignore; every
// later command then exited 2 on the guard those writers do have, leaving a
// store nothing could write to. SKILL.md, docs/reference.md and
// docs/architecture.md all claimed this was impossible.

test('init refuses to build a store inside the read-only source tree, writing nothing', async () => {
  const result = await runInit({ ...BASE(), sourcePath: root })
  expect(result).toBe(2)
  expect(existsSync(storePaths(root).dir)).toBe(false)
  expect(existsSync(join(root, '.gitignore'))).toBe(false)
})

// The three write targets init checks share a parent for an ordinary target
// root, so a plain path comparison can never tell them apart. A symlink can:
// here .migrate resolves into the source tree while the target root itself is
// nowhere near it, so only the store-path legs of the check fire. The guard
// resolves real paths, which is what makes this reachable at all.
test('init refuses when only the store directory resolves into the source tree', async () => {
  const stash = join(source, 'stash')
  await mkdir(stash, { recursive: true })
  await symlink(stash, storePaths(root).dir)
  expect(await runInit(BASE())).toBe(2)
  expect(existsSync(join(stash, 'config.toml'))).toBe(false)
  expect(existsSync(join(stash, 'queue'))).toBe(false)
})

// The mirror image, and the leg the store-path checks alone would miss: the
// store is fine, but the target's .gitignore is a symlink into the source, so
// the append would edit a file in the read-only checkout. Refused before
// anything is created, so the planted file is byte-identical afterwards.
test('init refuses when only the .gitignore resolves into the source tree', async () => {
  const planted = join(source, '.gitignore')
  await writeFile(planted, 'node_modules/\n')
  await symlink(planted, join(root, '.gitignore'))
  expect(await runInit(BASE())).toBe(2)
  expect(await readFile(planted, 'utf8')).toBe('node_modules/\n')
  expect(existsSync(storePaths(root).dir)).toBe(false)
})

// Final-review finding, Important 2: the append was guarded by
// `if (existsSync(gitignore))`, so a target repo with no .gitignore of its own
// got no ignore entry at all and `git add -A` staged .migrate/.env on the
// first commit of the run. The `leaks` gate that would catch the committed
// result is opt-in, so nothing else stood behind this.

test('init creates a .gitignore listing the env file when the target has none, and says so', async () => {
  const { code, text } = await captureStdout(() => runInit(BASE()))
  expect(code).toBe(0)
  const gitignore = join(root, '.gitignore')
  expect(await readFile(gitignore, 'utf8')).toBe('.migrate/.env\n')
  expect(text).toContain(`init: created ${gitignore} with .migrate/.env`)
})

test('init reports the append when the target already has a .gitignore', async () => {
  const gitignore = join(root, '.gitignore')
  await writeFile(gitignore, 'node_modules/\n')
  const { code, text } = await captureStdout(() => runInit(BASE()))
  expect(code).toBe(0)
  expect(text).toContain(`init: appended .migrate/.env to ${gitignore}`)
})

// The claim the two tests above exist to make is not really about file
// content, it is that git will not stage the env file. Asserted against real
// git rather than by reading the ignore text, since the ignore text being
// right and git still staging the file is precisely the failure that shipped.
test('git does not stage .migrate/.env after init, on a target that had no .gitignore', async () => {
  await Bun.spawn(['git', 'init', '-q'], { cwd: root, stdout: 'ignore', stderr: 'ignore' }).exited
  expect(await runInit(BASE())).toBe(0)
  await writeFile(storePaths(root).env, 'API_TOKEN=super-secret\n')
  const proc = Bun.spawn(['git', 'check-ignore', '.migrate/.env'], {
    cwd: root,
    stdout: 'pipe',
    stderr: 'ignore',
  })
  const listed = await new Response(proc.stdout).text()
  await proc.exited
  expect(proc.exitCode).toBe(0)
  expect(listed.trim()).toBe('.migrate/.env')
})
