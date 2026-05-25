import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export type PathFilterConfig = {
  exclude: string[]
  include: string[]
  useDefaults: boolean
}

export const DEFAULT_EXCLUDES: readonly string[] = [
  // Lockfiles
  '**/package-lock.json',
  '**/yarn.lock',
  '**/pnpm-lock.yaml',
  '**/bun.lock',
  '**/bun.lockb',
  '**/Cargo.lock',
  '**/Pipfile.lock',
  '**/poetry.lock',
  '**/composer.lock',
  '**/Gemfile.lock',
  '**/uv.lock',
  // Build / vendored / dependency dirs
  'dist/**',
  'build/**',
  'out/**',
  '.next/**',
  '.nuxt/**',
  '.svelte-kit/**',
  '.turbo/**',
  '.cache/**',
  'coverage/**',
  'node_modules/**',
  'vendor/**',
  // Generated source
  '**/*.generated.*',
  '**/*.gen.*',
  '**/*.pb.go',
  '**/*.pb.ts',
  '**/*.pb.js',
  '**/*_pb2.py',
  '**/*.min.js',
  '**/*.min.css',
  '**/*.map',
  // Snapshot fixtures
  '**/*.snap',
  '**/__snapshots__/**',
  '**/.snapshots/**',
]

export function globToRegex(pattern: string): RegExp {
  let re = ''
  let i = 0
  while (i < pattern.length) {
    const ch = pattern[i]
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        re += '.*'
        i += 2
        if (pattern[i] === '/') i += 1
      } else {
        re += '[^/]*'
        i += 1
      }
    } else if (ch === '?') {
      re += '[^/]'
      i += 1
    } else if (ch && /[.+^$()|[\]\\{}]/.test(ch)) {
      re += `\\${ch}`
      i += 1
    } else {
      re += ch ?? ''
      i += 1
    }
  }
  return new RegExp(`^${re}$`)
}

export function matchesAny(path: string, patterns: readonly string[]): string | null {
  for (const pat of patterns) {
    if (globToRegex(pat).test(path)) return pat
  }
  return null
}

export async function loadPathFilterConfig(cwd: string): Promise<PathFilterConfig> {
  const cfgPath = join(cwd, '.magpie.json')
  if (!existsSync(cfgPath)) {
    return { exclude: [...DEFAULT_EXCLUDES], include: [], useDefaults: true }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(cfgPath, 'utf8'))
  } catch {
    return { exclude: [...DEFAULT_EXCLUDES], include: [], useDefaults: true }
  }
  const obj = (parsed ?? {}) as Record<string, unknown>
  const userExclude = Array.isArray(obj.exclude)
    ? obj.exclude.filter((s): s is string => typeof s === 'string')
    : []
  const userInclude = Array.isArray(obj.include)
    ? obj.include.filter((s): s is string => typeof s === 'string')
    : []
  const useDefaults = obj.useDefaults !== false
  return {
    exclude: useDefaults ? [...DEFAULT_EXCLUDES, ...userExclude] : userExclude,
    include: userInclude,
    useDefaults,
  }
}

export type ExcludedFile = { path: string; pattern: string }
export type FilterDiffResult = { filtered: string; excluded: ExcludedFile[] }

const FILE_HEADER = /^diff --git a\/(.+?) b\/(.+?)$/m

export function filterDiff(rawDiff: string, config: PathFilterConfig): FilterDiffResult {
  if (!rawDiff) return { filtered: '', excluded: [] }
  const chunks = rawDiff.split(/^(?=diff --git )/m)
  const kept: string[] = []
  const excluded: ExcludedFile[] = []
  for (const chunk of chunks) {
    if (!chunk.startsWith('diff --git ')) {
      if (chunk.trim()) kept.push(chunk)
      continue
    }
    const m = chunk.match(FILE_HEADER)
    const path = m?.[2] ?? m?.[1]
    if (!path) {
      kept.push(chunk)
      continue
    }
    if (config.include.length > 0) {
      if (matchesAny(path, config.include)) {
        kept.push(chunk)
        continue
      }
      excluded.push({ path, pattern: 'not-in-include' })
      continue
    }
    const hit = matchesAny(path, config.exclude)
    if (hit) {
      excluded.push({ path, pattern: hit })
      continue
    }
    kept.push(chunk)
  }
  return { filtered: kept.join(''), excluded }
}
