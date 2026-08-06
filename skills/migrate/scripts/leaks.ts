import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { relative } from 'node:path'
import { storePaths } from './paths.ts'
import type { Violation } from './types.ts'

const MIN_SECRET_LENGTH = 8

export function parseEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const withoutExport = line.startsWith('export ') ? line.slice(7) : line
    const at = withoutExport.indexOf('=')
    if (at === -1) continue
    const key = withoutExport.slice(0, at).trim()
    let value = withoutExport.slice(at + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
  return env
}

// A URL is excluded because artifacts reference the environment by host on
// purpose; flagging it would make the gate cry wolf on correct prose.
export function secretValues(env: Record<string, string>): string[] {
  const out: string[] = []
  for (const value of Object.values(env)) {
    if (value.length < MIN_SECRET_LENGTH) continue
    if (value === 'true' || value === 'false') continue
    if (/^https?:\/\//.test(value)) continue
    out.push(value)
  }
  return out
}

export async function scanLeaks(opts: { root: string; gitBin?: string }): Promise<Violation[]> {
  const paths = storePaths(opts.root)
  if (!existsSync(paths.env)) return []
  const env = parseEnv(await readFile(paths.env, 'utf8'))
  const secrets = secretValues(env)
  if (secrets.length === 0) return []

  const nameFor = (value: string): string =>
    Object.entries(env).find(([, v]) => v === value)?.[0] ?? '<unknown>'

  const violations: Violation[] = []

  const glob = new Bun.Glob('**/*')
  for await (const rel of glob.scan({ cwd: paths.dir, onlyFiles: true, dot: true })) {
    if (rel === '.env') continue
    const abs = `${paths.dir}/${rel}`
    // A file the scanner could not read is a file it did not scan. Treating
    // that as a clean result would be a false negative, so an unreadable
    // artifact is reported as a leaks violation rather than skipped in silence.
    let text: string
    try {
      text = await readFile(abs, 'utf8')
    } catch {
      violations.push({
        gate: 'leaks',
        message: `${relative(opts.root, abs)} could not be read, so it was not checked for leaked credentials`,
      })
      continue
    }
    for (const secret of secrets) {
      if (text.includes(secret)) {
        violations.push({
          gate: 'leaks',
          message: `value of ${nameFor(secret)} appears in ${relative(opts.root, abs)}`,
        })
      }
    }
  }

  const gitBin = opts.gitBin ?? 'git'
  if (existsSync(`${opts.root}/.git`)) {
    for (const secret of secrets) {
      const proc = Bun.spawn([gitBin, 'log', '--oneline', `-S${secret}`], {
        cwd: opts.root,
        stdout: 'pipe',
        stderr: 'ignore',
      })
      const out = await new Response(proc.stdout).text()
      await proc.exited
      if (out.trim().length > 0) {
        violations.push({
          gate: 'leaks',
          message: `value of ${nameFor(secret)} appears in git history (${out.trim().split('\n').length} commit(s))`,
        })
      }
    }
  }

  return violations
}
