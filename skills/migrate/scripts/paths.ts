import { existsSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'

export const STORE_DIR = '.migrate'

export type StorePaths = {
  dir: string
  config: string
  elements: string
  requirements: string
  capabilities: string
  deltas: string
  census: string
  phases: string
  queueDir: string
  seamJson: string
  seamMd: string
  parityBasis: string
  handoff: string
  forecastAssumptions: string
  env: string
}

export function storePaths(root: string): StorePaths {
  const dir = join(root, STORE_DIR)
  return {
    dir,
    config: join(dir, 'config.toml'),
    elements: join(dir, 'elements.jsonl'),
    requirements: join(dir, 'requirements.jsonl'),
    capabilities: join(dir, 'capabilities.jsonl'),
    deltas: join(dir, 'deltas.jsonl'),
    census: join(dir, 'census.jsonl'),
    phases: join(dir, 'phases.json'),
    queueDir: join(dir, 'queue'),
    seamJson: join(dir, 'seam.json'),
    seamMd: join(dir, 'seam.md'),
    parityBasis: join(dir, 'parity-basis.md'),
    handoff: join(dir, 'handoff.json'),
    forecastAssumptions: join(dir, 'forecast-assumptions.md'),
    env: join(dir, '.env'),
  }
}

export async function findStoreRoot(startDir: string): Promise<string | null> {
  let current = resolve(startDir)
  for (;;) {
    if (existsSync(join(current, STORE_DIR))) return current
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

// A shared string prefix is not containment: legacy-notes/ is not inside legacy/.
// relative() gives '..' as its first segment for anything outside, and '' for the
// root itself, which counts as inside. This is the one containment predicate
// both the write side (this file) and the read side (citations.ts) use, so the
// two cannot drift into disagreeing again about what "inside" means.
export function isContained(inner: string, outer: string): boolean {
  const rel = relative(outer, inner)
  return rel === '' || !(rel.startsWith(`..${sep}`) || rel === '..')
}

// Resolves a path to its canonical real form -- following symlinks and, on a
// case-insensitive filesystem, normalizing to the on-disk case -- even when
// the path itself does not exist yet. A write target is normally exactly
// that: a file `writeAtomically` is about to create. realpath() alone would
// fail on it with ENOENT, so this walks up to the nearest ancestor that does
// exist, resolves that ancestor for real, and reattaches the non-existent
// remainder unchanged (a path segment that does not exist cannot itself be a
// symlink or a case variant, so there is nothing further to resolve about it).
// If no ancestor at all exists (a bogus root), it falls back to the lexically
// resolved path rather than throwing out of what is meant to be a yes/no check.
async function realOrNearestAncestor(target: string): Promise<string> {
  const resolved = resolve(target)
  let current = resolved
  const suffix: string[] = []
  for (;;) {
    try {
      const real = await realpath(current)
      return suffix.length > 0 ? join(real, ...suffix.reverse()) : real
    } catch {
      const parent = dirname(current)
      if (parent === current) return resolved
      suffix.push(basename(current))
      current = parent
    }
  }
}

// Lexical comparison alone (the previous implementation) is fooled two ways:
// a symlink inside the target tree that points into the source tree changes
// what a path really resolves to without changing its literal text, and on a
// case-insensitive volume two differently-cased spellings of the same
// directory compare as unrelated strings even though they are the same
// physical location. Both are closed by resolving real paths (which follow
// symlinks and normalize case) before the containment check, exactly as
// citations.ts already does on the read side.
export async function assertNotUnderSource(target: string, sourcePath: string): Promise<void> {
  const realRoot = await realOrNearestAncestor(resolve(sourcePath))
  const realTarget = await realOrNearestAncestor(resolve(target))
  if (isContained(realTarget, realRoot)) {
    throw new Error(`refusing to write inside the read-only source tree: ${target}`)
  }
}
