import { loadConfig } from './config.ts'
import { LockError, withStoreLock } from './lock.ts'
import { assertNotUnderSource, storePaths } from './paths.ts'
import { isPhase, recordBatch } from './phases.ts'
import { readJsonFile, readRows, upsertRows, writeRows } from './store.ts'
import type { Delta, Element, Requirement } from './types.ts'
import { validateDelta, validateElement, validateRequirement } from './validate.ts'

export type ImportKind = 'elements' | 'reqs' | 'deltas'

type BatchFile = { batch?: string; phase?: string; rows?: unknown[] }

export async function runImport(opts: {
  root: string
  kind: ImportKind
  batchFile: string
  forceUnlock?: boolean
}): Promise<number> {
  const cfg = await loadConfig(opts.root)
  let raw: unknown
  try {
    raw = await readJsonFile(opts.batchFile)
  } catch (e) {
    // Not shaped like a batch file at all (missing, or not valid JSON): a
    // malformed request, same class as the missing-field check just below.
    process.stderr.write(`import: ${(e as Error).message}\n`)
    return 2
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    process.stderr.write('import: batch file needs {"batch": id, "phase": name, "rows": [...]}\n')
    return 2
  }
  const parsed = raw as BatchFile
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

  // A repeated id within one batch is an authoring error: keeping the last one
  // silently would discard a row nobody was told about. Name every id that
  // recurs so the whole batch is refused under the all-or-nothing rule below.
  const idCounts = new Map<string, number>()
  for (const row of validated) {
    idCounts.set(row.id, (idCounts.get(row.id) ?? 0) + 1)
  }
  for (const [id, count] of idCounts) {
    if (count > 1) errors.push(`batch: id ${id} appears ${count} times in this batch`)
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
  try {
    await assertNotUnderSource(target, cfg.source.path)
  } catch (e) {
    // A store whose configured source.path resolves to include its own
    // target path (e.g. source.path: '.') can never be written to, for any
    // batch content whatsoever: an environment/config problem, invariant
    // across every possible row, not a property of this batch's data. Same
    // usage-error class as "no .migrate store found above the cwd" and
    // "config.toml not found" elsewhere in this CLI, not a batch-content
    // failure (1).
    process.stderr.write(`import: ${(e as Error).message}\n`)
    return 2
  }

  // The read, the upsert, the rewrite, and the batch record are one critical
  // section. Splitting them lets a second importer read this one's base,
  // rewrite the file from it, and silently drop every row written in between.
  let merged: { added: number; updated: number }
  try {
    merged = await withStoreLock(
      opts.root,
      async () => {
        const existing = await readRows<Element | Requirement | Delta>(target)
        const result = upsertRows(existing as { id: string }[], validated)
        await writeRows(target, result.rows, cfg.source.path)
        await recordBatch(
          opts.root,
          phase,
          { id: batchId, count: validated.length },
          cfg.source.path,
        )
        return { added: result.added, updated: result.updated }
      },
      {
        cmd: 'import',
        ...(opts.forceUnlock ? { force: true } : {}),
        onWait: (m) => process.stderr.write(`import: ${m}\n`),
      },
    )
  } catch (e) {
    // A lock failure is neither bad batch content (1) nor a malformed request
    // (2): the request is fine and would succeed on retry, so it gets its own
    // class a caller can branch on.
    if (e instanceof LockError) {
      process.stderr.write(`import: ${e.message}\n`)
      return 3
    }
    throw e
  }

  process.stdout.write(
    `import ${opts.kind}: ${merged.added} added, ${merged.updated} updated, batch ${batchId}\n`,
  )
  return 0
}
