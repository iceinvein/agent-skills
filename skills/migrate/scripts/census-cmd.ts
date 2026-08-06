import { censusKey, validateCensus } from './census.ts'
import { loadConfig } from './config.ts'
import { storePaths } from './paths.ts'
import { readJsonFile, readRows, writeRows } from './store.ts'
import type { Census } from './types.ts'

export async function runCensus(opts: { root: string; file: string }): Promise<number> {
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
    for (const e of result.errors) process.stderr.write(`census: ${e}\n`)
    return 1
  }
  const path = storePaths(opts.root).census
  const existing = await readRows<Census>(path)
  const key = censusKey(result.value)
  // A re-run of the same census subject replaces its record rather than
  // stacking a second one, so the gate never sees two answers for one subject.
  const rows = existing.filter((r) => censusKey(r) !== key)
  rows.push(result.value)
  await writeRows(path, rows, cfg.source.path)
  process.stdout.write(`census: recorded ${key}\n`)
  return 0
}
