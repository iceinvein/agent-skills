import { flow } from './adapters/flow.ts'
import { github } from './adapters/github.ts'
import { markdown } from './adapters/markdown.ts'
import { loadConfig } from './config.ts'
import { computeCoverage, renderCoverage } from './coverage.ts'
import { type Adapter, type HandoffInput, loadHandoff } from './handoff.ts'
import { storePaths } from './paths.ts'
import { readRows } from './store.ts'
import type { Capability, Delta, Requirement } from './types.ts'

const ADAPTERS: Record<string, Adapter> = { markdown, github, flow }

export async function runCoverage(opts: {
  root: string
  adapter?: string
  gitBin?: string
  ghBin?: string
}): Promise<number> {
  const cfg = await loadConfig(opts.root)
  const name = opts.adapter ?? cfg.handoff.adapter
  const adapter = ADAPTERS[name]
  if (!adapter) {
    process.stderr.write(
      `coverage: unknown adapter ${name}; want one of ${Object.keys(ADAPTERS).sort().join(', ')}\n`,
    )
    return 2
  }

  const handoff = await loadHandoff(opts.root)
  if (!handoff) {
    // Not zero built. There is no denominator at all, because nothing has been
    // emitted, and reporting 0/0 would read as a measurement.
    process.stderr.write(
      'coverage: no handoff.json in the store; run `migrate handoff` before reading progress back\n',
    )
    return 1
  }

  if (!adapter.throughput) {
    // Named rather than reported as zero built: "this adapter cannot tell you"
    // and "nothing has been delivered" are very different claims.
    process.stderr.write(
      `coverage: adapter ${name} reports no throughput, so built-versus-total cannot be read back through it\n`,
    )
    return 1
  }

  const paths = storePaths(opts.root)
  const input: HandoffInput = {
    requirements: await readRows<Requirement>(paths.requirements),
    capabilities: await readRows<Capability>(paths.capabilities),
    deltas: await readRows<Delta>(paths.deltas),
    config: cfg,
    root: opts.root,
    gitBin: opts.gitBin ?? 'git',
    ghBin: opts.ghBin ?? 'gh',
  }

  let throughput: Awaited<ReturnType<NonNullable<Adapter['throughput']>>>
  try {
    throughput = await adapter.throughput(input)
  } catch (e) {
    process.stderr.write(`coverage: ${(e as Error).message}\n`)
    return 1
  }

  const report = computeCoverage({ requirements: input.requirements, handoff, throughput })
  process.stdout.write(`${renderCoverage(report)}\n`)

  if (report.unknown.length > 0) {
    // The emitted work and the store have diverged: something out there is
    // reporting progress on a requirement this store has never heard of.
    for (const fr of report.unknown) {
      process.stderr.write(
        `coverage: ${fr} was reported complete but is not in the registry; the emitted work and the store have diverged\n`,
      )
    }
    return 1
  }
  return 0
}
