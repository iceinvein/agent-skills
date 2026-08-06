import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { storePaths } from './paths.ts'

export const DEFAULT_SURFACES: readonly string[] = [
  'routes',
  'tables',
  'jobs',
  'reports',
  'screens',
  'integrations',
  'workflows',
  'settings',
]

export const DEFAULT_CLOSERS: readonly string[] = [
  'cross-capability-workflow',
  'scope-injection',
  'read-write-symmetry',
]

export type Config = {
  source: {
    path: string
    scope: string
    stack: string
    vcs: string
    basis: 'runnable' | 'source-only'
  }
  target: {
    name: string
    stack: string
    parity_test_path: string
    layout: Record<string, string>
    commands: Record<string, string>
  }
  surfaces: string[]
  surfaceSingular: Record<string, string>
  closers: string[]
  handoff: { adapter: string }
}

export type ConfigInit = {
  sourcePath: string
  scope: string
  targetName: string
  sourceStack?: string
  targetStack?: string
  vcs?: string
  basis?: 'runnable' | 'source-only'
}

function req(obj: Record<string, unknown> | undefined, key: string, where: string): string {
  const value = obj?.[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`config.toml: missing or empty ${where}.${key}`)
  }
  return value
}

export async function loadConfig(root: string): Promise<Config> {
  const path = storePaths(root).config
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    throw new Error(`config.toml not found at ${path}; run 'migrate init' first`)
  }
  const raw = Bun.TOML.parse(text) as Record<string, Record<string, unknown> | undefined>
  const source = raw.source
  const target = raw.target
  const sourcePath = req(source, 'path', 'source')
  const sourceScope = req(source, 'scope', 'source')
  const sourceStack = req(source, 'stack', 'source')
  const sourceVcs = req(source, 'vcs', 'source')
  const basis = req(source, 'basis', 'source')
  if (basis !== 'runnable' && basis !== 'source-only') {
    throw new Error(`config.toml: source.basis must be runnable or source-only, got ${basis}`)
  }
  const surfacesTable = raw.surfaces
  const declared = surfacesTable?.types
  const singular = (surfacesTable?.singular ?? {}) as Record<string, string>
  const closersTable = raw.closers
  const declaredClosers = closersTable?.set
  const handoffTable = raw.handoff

  return {
    source: {
      path: sourcePath,
      scope: sourceScope,
      stack: sourceStack,
      vcs: sourceVcs,
      basis,
    },
    target: {
      name: req(target, 'name', 'target'),
      stack: req(target, 'stack', 'target'),
      parity_test_path: req(target, 'parity_test_path', 'target'),
      layout: (target?.layout ?? {}) as Record<string, string>,
      commands: (target?.commands ?? {}) as Record<string, string>,
    },
    surfaces: Array.isArray(declared) ? (declared as string[]) : [...DEFAULT_SURFACES],
    surfaceSingular: singular,
    closers: Array.isArray(declaredClosers) ? (declaredClosers as string[]) : [...DEFAULT_CLOSERS],
    handoff: { adapter: (handoffTable?.adapter as string | undefined) ?? 'markdown' },
  }
}

export async function writeConfig(root: string, init: ConfigInit): Promise<void> {
  const templatePath = join(import.meta.dir, '..', 'templates', 'config.toml')
  const template = await readFile(templatePath, 'utf8')
  const rendered = template
    .replaceAll('{{SOURCE_PATH}}', init.sourcePath)
    .replaceAll('{{SCOPE}}', init.scope)
    .replaceAll('{{SOURCE_STACK}}', init.sourceStack ?? 'unknown')
    .replaceAll('{{VCS}}', init.vcs ?? 'none')
    .replaceAll('{{BASIS}}', init.basis ?? 'source-only')
    .replaceAll('{{TARGET_NAME}}', init.targetName)
    .replaceAll('{{TARGET_STACK}}', init.targetStack ?? 'unknown')
  await writeFile(storePaths(root).config, rendered)
}
