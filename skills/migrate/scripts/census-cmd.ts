import { balanceOf, censusKey, validateCensus } from './census.ts'
import { loadConfig } from './config.ts'
import { LockError, withStoreLock } from './lock.ts'
import { assertNotUnderSource, storePaths } from './paths.ts'
import { readJsonFile, readRows, writeRows } from './store.ts'
import type { Census } from './types.ts'

export async function runCensus(opts: {
  root: string
  file: string
  forceUnlock?: boolean
}): Promise<number> {
  const cfg = await loadConfig(opts.root)
  let parsed: unknown
  try {
    parsed = await readJsonFile(opts.file)
  } catch (e) {
    // Missing or unparseable file: a usage error, same class as a malformed
    // batch file in import-cmd.ts, not something the balance check can see.
    process.stderr.write(`census: ${(e as Error).message}\n`)
    return 2
  }
  const result = validateCensus(parsed)
  if (!result.ok) {
    // Not shaped like a census record at all: missing/mistyped fields, an
    // unknown kind, or a duplicate queued id/skipped element. This is the
    // analogue of import-cmd.ts's envelope check, not its row check, because
    // a census file has no envelope -- the file is the one row -- so a usage
    // error (2) is the right class, distinct from a balance failure below.
    for (const e of result.errors) process.stderr.write(`census: ${e}\n`)
    return 2
  }
  // The record is structurally sound; balance is the one substantive domain
  // claim this task exists to check, so it gets its own exit-code class (1,
  // an operation failure) instead of being folded into shape validation.
  const imbalance = balanceOf(result.value)
  if (imbalance) {
    process.stderr.write(`census: ${imbalance}\n`)
    return 1
  }
  const path = storePaths(opts.root).census
  try {
    await assertNotUnderSource(path, cfg.source.path)
  } catch (e) {
    // A store whose configured source.path resolves to include its own
    // target path can never be written to, regardless of this record's
    // content: an environment/config problem, not a balance-check-visible
    // property of the data, so it gets the same usage-error class as the
    // shape check above, not the balance-check's operation failure (1).
    process.stderr.write(`census: ${(e as Error).message}\n`)
    return 2
  }
  const key = censusKey(result.value)
  try {
    await withStoreLock(
      opts.root,
      async () => {
        const existing = await readRows<Census>(path)
        // A re-run of the same census subject replaces its record rather than
        // stacking a second one, so the gate never sees two answers for one
        // subject.
        const rows = existing.filter((r) => censusKey(r) !== key)
        rows.push(result.value)
        await writeRows(path, rows, cfg.source.path)
      },
      {
        cmd: 'census',
        ...(opts.forceUnlock ? { force: true } : {}),
        onWait: (m) => process.stderr.write(`census: ${m}\n`),
      },
    )
  } catch (e) {
    if (e instanceof LockError) {
      process.stderr.write(`census: ${e.message}\n`)
      return 3
    }
    throw e
  }
  process.stdout.write(`census: recorded ${key}\n`)
  return 0
}
