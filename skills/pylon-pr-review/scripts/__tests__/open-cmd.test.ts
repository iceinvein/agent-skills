import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runOpen } from '../open-cmd.ts'

let home: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'prskill-open-'))
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

async function makeRunWithFindings(id: string): Promise<string> {
  const path = join(home, id)
  await mkdir(join(path, 'screen'), { recursive: true })
  await writeFile(join(path, 'screen', 'findings.html'), '<html><body>x</body></html>')
  return path
}

async function makeRunWithProgressOnly(id: string): Promise<string> {
  const path = join(home, id)
  await mkdir(join(path, 'screen'), { recursive: true })
  await writeFile(join(path, 'screen', 'progress.html'), '<html><body>x</body></html>')
  return path
}

test('dry-run prints the opener and findings.html for latest run', async () => {
  await makeRunWithFindings('pr-1-1000')
  const out: string[] = []
  const write = process.stdout.write.bind(process.stdout)
  process.stdout.write = ((s: string) => {
    out.push(s)
    return true
  }) as typeof process.stdout.write
  try {
    const code = await runOpen({ home, dryRun: true, opener: 'fakeopen' })
    expect(code).toBe(0)
  } finally {
    process.stdout.write = write
  }
  expect(out.join('')).toContain('fakeopen')
  expect(out.join('')).toContain('findings.html')
})

test('falls back to progress.html when findings.html is absent', async () => {
  await makeRunWithProgressOnly('pr-2-2000')
  const out: string[] = []
  const write = process.stdout.write.bind(process.stdout)
  process.stdout.write = ((s: string) => {
    out.push(s)
    return true
  }) as typeof process.stdout.write
  try {
    await runOpen({ home, dryRun: true, opener: 'fakeopen' })
  } finally {
    process.stdout.write = write
  }
  expect(out.join('')).toContain('progress.html')
  expect(out.join('')).not.toContain('findings.html')
})

test('explicit id is honored', async () => {
  await makeRunWithFindings('pr-1-1000')
  await makeRunWithFindings('pr-2-2000')
  const out: string[] = []
  const write = process.stdout.write.bind(process.stdout)
  process.stdout.write = ((s: string) => {
    out.push(s)
    return true
  }) as typeof process.stdout.write
  try {
    await runOpen({ home, idOrPath: 'pr-1-1000', dryRun: true, opener: 'fakeopen' })
  } finally {
    process.stdout.write = write
  }
  expect(out.join('')).toContain('pr-1-1000')
})

test('returns non-zero when run id missing', async () => {
  const errs: string[] = []
  const write = process.stderr.write.bind(process.stderr)
  process.stderr.write = ((s: string) => {
    errs.push(s)
    return true
  }) as typeof process.stderr.write
  try {
    const code = await runOpen({ home, idOrPath: 'does-not-exist', dryRun: true })
    expect(code).toBe(1)
  } finally {
    process.stderr.write = write
  }
  expect(errs.join('')).toContain('not found')
})

test('returns 2 when run dir has no screen output', async () => {
  await mkdir(join(home, 'pr-1-1000', 'screen'), { recursive: true })
  const errs: string[] = []
  const write = process.stderr.write.bind(process.stderr)
  process.stderr.write = ((s: string) => {
    errs.push(s)
    return true
  }) as typeof process.stderr.write
  try {
    const code = await runOpen({ home, idOrPath: 'pr-1-1000', dryRun: true })
    expect(code).toBe(2)
  } finally {
    process.stderr.write = write
  }
  expect(errs.join('')).toContain('no findings.html')
})
