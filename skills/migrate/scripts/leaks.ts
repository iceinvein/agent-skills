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
//
// Everything below matches secrets by substring, which has two inherent
// blind spots that are not worth chasing: a secret that got line-wrapped
// when it was pasted (a newline now sits inside it) and a paste that differs
// from the source only in case. Widening the match to catch either would
// trade a rare miss for false positives common enough to make the gate
// ignorable, so both are accepted as known limits rather than bugs.
function isSecretValue(value: string): boolean {
  if (value.length < MIN_SECRET_LENGTH) return false
  if (/^https?:\/\//.test(value)) return false
  return true
}

export function secretValues(env: Record<string, string>): string[] {
  return secretEntries(env).map((entry) => entry.value)
}

type SecretEntry = { value: string; names: string[] }

// Two env vars can legitimately hold the same value (a password reused
// between a normal and a read-only runtime account, for instance). Grouping
// by value up front means a shared value is reported once per file, or once
// per history, naming every variable that holds it, instead of once per
// variable with the wrong one picked.
function secretEntries(env: Record<string, string>): SecretEntry[] {
  const byValue = new Map<string, string[]>()
  for (const [name, value] of Object.entries(env)) {
    if (!isSecretValue(value)) continue
    const names = byValue.get(value)
    if (names) names.push(name)
    else byValue.set(value, [name])
  }
  return Array.from(byValue, ([value, names]) => ({ value, names }))
}

function violationFor(entry: SecretEntry, where: string): Violation {
  return { gate: 'leaks', message: `value of ${entry.names.join(', ')} appears in ${where}` }
}

async function scanArtifacts(
  dir: string,
  root: string,
  entries: SecretEntry[],
): Promise<Violation[]> {
  const violations: Violation[] = []
  const glob = new Bun.Glob('**/*')
  for await (const rel of glob.scan({ cwd: dir, onlyFiles: true, dot: true })) {
    if (rel === '.env') continue
    const abs = `${dir}/${rel}`
    // A file the scanner could not read is a file it did not scan. Treating
    // that as a clean result would be a false negative, so an unreadable
    // artifact is reported as a leaks violation rather than skipped in silence.
    let text: string
    try {
      text = await readFile(abs, 'utf8')
    } catch {
      violations.push({
        gate: 'leaks',
        message: `${relative(root, abs)} could not be read, so it was not checked for leaked credentials`,
      })
      continue
    }
    for (const entry of entries) {
      if (text.includes(entry.value)) violations.push(violationFor(entry, relative(root, abs)))
    }
  }
  return violations
}

// Reads a subprocess's stdout in whatever chunks the pipe delivers and tests
// each chunk for the secrets, without ever buffering the full history into
// one string. A secret can straddle the boundary between two chunks, so each
// pass keeps a tail of the combined text at least as long as the longest
// secret minus one character and prepends it to the next chunk; that is
// enough overlap for a split match to be whole again on the next check.
async function findInStream(
  stream: ReadableStream<Uint8Array>,
  entries: SecretEntry[],
): Promise<SecretEntry[]> {
  const maxLen = Math.max(...entries.map((entry) => entry.value.length))
  const remaining = new Map(entries.map((entry) => [entry.value, entry] as const))
  const found: SecretEntry[] = []
  const decoder = new TextDecoder()
  let carry = ''
  const reader = stream.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      const chunkText = done ? decoder.decode() : decoder.decode(value, { stream: true })
      const combined = carry + chunkText
      for (const [secretValue, entry] of remaining) {
        if (combined.includes(secretValue)) {
          found.push(entry)
          remaining.delete(secretValue)
        }
      }
      if (done || remaining.size === 0) break
      carry = combined.slice(-(maxLen - 1))
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  return found
}

// git log -S<secret> would put the raw value on the process argument list,
// readable by any other local user via ps or /proc for the life of the call.
// A module whose entire purpose is stopping credentials from escaping must
// not do that itself, so history is streamed instead: one subprocess for the
// whole run, no secret in its argv, matched against the streamed diff text
// in-process. --all covers a secret that only ever landed on a branch other
// than the one currently checked out, not just an older commit on this one.
async function scanGitHistory(
  root: string,
  gitBin: string,
  entries: SecretEntry[],
): Promise<Violation[]> {
  if (!existsSync(`${root}/.git`)) return []

  let proc: Bun.Subprocess<'ignore', 'pipe', 'ignore'>
  try {
    proc = Bun.spawn([gitBin, 'log', '-p', '--all'], {
      cwd: root,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'ignore',
    })
  } catch {
    return [{ gate: 'leaks', message: 'could not run git to check history for leaked credentials' }]
  }

  let found: SecretEntry[]
  try {
    found = await findInStream(proc.stdout, entries)
  } finally {
    proc.kill()
    await proc.exited.catch(() => {})
  }

  return found.map((entry) => violationFor(entry, 'git history'))
}

export async function scanLeaks(opts: { root: string; gitBin?: string }): Promise<Violation[]> {
  const paths = storePaths(opts.root)
  if (!existsSync(paths.env)) return []
  const env = parseEnv(await readFile(paths.env, 'utf8'))
  const entries = secretEntries(env)
  if (entries.length === 0) return []

  const artifactViolations = await scanArtifacts(paths.dir, opts.root, entries)
  const historyViolations = await scanGitHistory(opts.root, opts.gitBin ?? 'git', entries)
  return [...artifactViolations, ...historyViolations]
}
