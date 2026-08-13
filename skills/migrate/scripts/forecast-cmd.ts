import { existsSync } from 'node:fs'
import { flow } from './adapters/flow.ts'
import { github } from './adapters/github.ts'
import { markdown } from './adapters/markdown.ts'
import { parseAssumptions, validateAssumptions } from './assumptions.ts'
import { loadConfig } from './config.ts'
import { computeCoverage } from './coverage.ts'
import { demandOf, project, renderForecast, velocities } from './forecast.ts'
import { type Adapter, type HandoffInput, loadHandoff } from './handoff.ts'
import { storePaths } from './paths.ts'
import { readRows, readTextFile } from './store.ts'
import type { Capability, Delta, Requirement } from './types.ts'

const ADAPTERS: Record<string, Adapter> = { markdown, github, flow }

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export async function runForecast(opts: {
  root: string
  adapter?: string
  gitBin?: string
  ghBin?: string
  now?: () => string
}): Promise<number> {
  const cfg = await loadConfig(opts.root)
  const paths = storePaths(opts.root)

  const loaded = await loadHandoff(opts.root)
  if (loaded.kind === 'invalid') {
    for (const e of loaded.errors) process.stderr.write(`forecast: handoff.json ${e}\n`)
    return 1
  }
  const handoff = loaded.kind === 'ok' ? loaded.value : null
  if (!handoff) {
    process.stderr.write(
      'forecast: no handoff.json in the store; run `migrate handoff` before projecting anything\n',
    )
    return 1
  }

  if (!existsSync(paths.forecastAssumptions)) {
    // Required, not optional. A projection nobody signed is exactly the
    // asserted number this method exists to refuse, so the file's absence is a
    // refusal rather than a set of defaults.
    process.stderr.write(
      `forecast: no ${paths.forecastAssumptions}; copy templates/forecast-assumptions.md there and attest it\n`,
    )
    return 1
  }

  let assumptions: ReturnType<typeof parseAssumptions>
  try {
    assumptions = parseAssumptions(
      await readTextFile(paths.forecastAssumptions),
      paths.forecastAssumptions,
    )
  } catch (e) {
    process.stderr.write(`forecast: ${(e as Error).message}\n`)
    return 1
  }

  const name = opts.adapter ?? cfg.handoff.adapter
  const adapter = ADAPTERS[name]
  if (!adapter) {
    process.stderr.write(
      `forecast: unknown adapter ${name}; want one of ${Object.keys(ADAPTERS).sort().join(', ')}\n`,
    )
    return 2
  }
  if (!adapter.throughput) {
    process.stderr.write(
      `forecast: adapter ${name} reports no throughput, so there is nothing measured to project from\n`,
    )
    return 1
  }

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
    process.stderr.write(`forecast: ${(e as Error).message}\n`)
    return 1
  }

  const coverage = computeCoverage({ requirements: input.requirements, handoff, throughput })

  // Validated against measured coverage rather than against itself: the file
  // has to account for the capabilities the store actually has confirmed
  // requirements in, not for whatever it happened to list.
  const errors = validateAssumptions(assumptions, coverage.caps)
  if (errors.length > 0) {
    for (const e of errors) process.stderr.write(`forecast: ${e}\n`)
    return 1
  }

  const now = (opts.now ?? today)()
  const demand = demandOf(assumptions, coverage.caps)
  const velocity = velocities(throughput.completions, now)
  const projections = project({ assumptions, demand, velocity, today: now })

  process.stdout.write(
    `${renderForecast({
      assumptions,
      demand,
      velocity,
      projections,
      today: now,
      undated: coverage.undated,
    })}\n`,
  )
  return 0
}
