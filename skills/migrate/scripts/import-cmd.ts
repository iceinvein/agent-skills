import { readFile } from 'node:fs/promises'
import { loadConfig } from './config.ts'
import { storePaths } from './paths.ts'
import { isPhase, recordBatch } from './phases.ts'
import { readRows, upsertRows, writeRows } from './store.ts'
import type { Delta, Element, Requirement } from './types.ts'
import { validateDelta, validateElement, validateRequirement } from './validate.ts'

export type ImportKind = 'elements' | 'reqs' | 'deltas'

type BatchFile = { batch?: string; phase?: string; rows?: unknown[] }

export async function runImport(opts: {
  root: string
  kind: ImportKind
  batchFile: string
}): Promise<number> {
  const cfg = await loadConfig(opts.root)
  const parsed = JSON.parse(await readFile(opts.batchFile, 'utf8')) as BatchFile
  const batchId = parsed.batch
  const phase = parsed.phase
  if (!batchId || !phase || !Array.isArray(parsed.rows)) {
    process.stderr.write('import: batch file needs {"batch": id, "phase": name, "rows": [...]}\n')
    return 2
  }
  if (!isPhase(phase)) {
    process.stderr.write(`import: unknown phase ${phase}\n`)
    return 2
  }

  const errors: string[] = []
  const validated: ({ id: string; batch: string } & Record<string, unknown>)[] = []
  for (const row of parsed.rows) {
    const result =
      opts.kind === 'elements'
        ? validateElement(row, cfg)
        : opts.kind === 'reqs'
          ? validateRequirement(row, cfg)
          : validateDelta(row, cfg)
    if (result.ok) {
      validated.push({ ...(result.value as object), batch: batchId } as never)
    } else {
      errors.push(...result.errors)
    }
  }

  // All or nothing. A partially-written batch is a store an agent cannot reason
  // about on resume: the batch id would claim rows that are not all there.
  if (errors.length > 0) {
    for (const e of errors) process.stderr.write(`import: ${e}\n`)
    process.stderr.write(`import: ${errors.length} error(s), nothing written\n`)
    return 1
  }

  const paths = storePaths(opts.root)
  const target =
    opts.kind === 'elements'
      ? paths.elements
      : opts.kind === 'reqs'
        ? paths.requirements
        : paths.deltas
  const existing = await readRows<Element | Requirement | Delta>(target)
  const merged = upsertRows(existing as { id: string }[], validated)
  await writeRows(target, merged.rows, cfg.source.path)
  await recordBatch(opts.root, phase, { id: batchId, count: validated.length }, cfg.source.path)

  process.stdout.write(
    `import ${opts.kind}: ${merged.added} added, ${merged.updated} updated, batch ${batchId}\n`,
  )
  return 0
}
