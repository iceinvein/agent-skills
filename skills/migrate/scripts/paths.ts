import { existsSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

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
// source root itself, which counts as inside.
export function assertNotUnderSource(target: string, sourcePath: string): void {
  const rel = relative(resolve(sourcePath), resolve(target))
  const outside = rel.startsWith(`..${sep}`) || rel === '..'
  if (!outside) {
    throw new Error(`refusing to write inside the read-only source tree: ${target}`)
  }
}
