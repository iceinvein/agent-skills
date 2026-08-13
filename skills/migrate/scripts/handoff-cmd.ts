import { flow } from './adapters/flow.ts'
import { github } from './adapters/github.ts'
import { markdown } from './adapters/markdown.ts'
import { runCheck } from './check.ts'
import { loadConfig } from './config.ts'
import {
  type Adapter,
  blockedRequirements,
  type HandoffFile,
  type HandoffInput,
  saveHandoff,
} from './handoff.ts'
import { withStoreLock } from './lock.ts'
import { storePaths } from './paths.ts'
import { recordBatch } from './phases.ts'
import { loadQueue } from './queue.ts'
import { readRows } from './store.ts'
import type { Capability, Delta, Requirement, WorkItem } from './types.ts'

const ADAPTERS: Record<string, Adapter> = { markdown, github, flow }

export function adapterNames(): string[] {
  return Object.keys(ADAPTERS).sort()
}

// Everything that must be true before any work item is emitted. Three sources,
// reported together so an operator sees the whole list rather than fixing one
// blocker at a time.
//
// The gate run is deliberately bounded at `adjudicate`. Citations and leaks are
// both mandatory before handoff, so they are switched on here rather than left
// to whatever the caller last used, but an unbounded run would also fire gate
// 12, which requires the handoff.json this command has not written yet. That
// would refuse every first handoff, permanently.
export async function preflight(root: string, opts: { gitBin?: string } = {}): Promise<string[]> {
  const blockers: string[] = []

  const check = await runCheck({
    root,
    citations: true,
    leaks: true,
    phase: 'adjudicate',
    ...(opts.gitBin ? { gitBin: opts.gitBin } : {}),
  })
  for (const v of check.violations) blockers.push(`[${v.gate}] ${v.message}`)

  const paths = storePaths(root)
  const { items } = await loadQueue(paths.queueDir)
  const open = items.filter((i) => i.status === 'open')
  for (const item of open) {
    blockers.push(`open queue item ${item.id} [${item.severity}]`)
  }

  const requirements = await readRows<Requirement>(paths.requirements)
  for (const { fr, queue } of blockedRequirements(requirements, new Set(open.map((i) => i.id)))) {
    blockers.push(`${fr} blocked by ${queue}`)
  }

  return blockers
}

function renderPlan(items: WorkItem[]): string {
  const lines = ['plan:']
  for (const item of items) {
    const deps = item.dependsOn.length > 0 ? ` after ${item.dependsOn.join(', ')}` : ''
    lines.push(`  ${item.key} (${item.frs.length} requirement(s))${deps}`)
  }
  return lines.join('\n')
}

export async function runHandoff(opts: {
  root: string
  adapter?: string
  dryRun?: boolean
  gitBin?: string
  ghBin?: string
  forceUnlock?: boolean
}): Promise<number> {
  const cfg = await loadConfig(opts.root)
  const name = opts.adapter ?? cfg.handoff.adapter
  const adapter = ADAPTERS[name]
  if (!adapter) {
    process.stderr.write(
      `handoff: unknown adapter ${name}; want one of ${adapterNames().join(', ')}\n`,
    )
    return 2
  }

  const blockers = await preflight(opts.root, {
    ...(opts.gitBin ? { gitBin: opts.gitBin } : {}),
  })
  if (blockers.length > 0) {
    // Named individually rather than counted, because each one is a separate
    // thing somebody has to go and do.
    for (const b of blockers) process.stderr.write(`handoff: ${b}\n`)
    process.stderr.write(`handoff: refusing to emit with ${blockers.length} blocker(s)\n`)
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

  let items: WorkItem[]
  try {
    items = await adapter.plan(input)
  } catch (e) {
    // An adapter refuses in plan() precisely so nothing is half-written; the
    // flow adapter's namespace check is the one that reaches here in practice.
    process.stderr.write(`handoff: ${(e as Error).message}\n`)
    return 1
  }

  if (opts.dryRun) {
    // Nothing is written, not even handoff.json. A dry run that wrote the
    // basis would satisfy gate 12 with nothing actually emitted.
    process.stdout.write(`${renderPlan(items)}\n`)
    process.stdout.write(`handoff: dry run, ${items.length} work item(s), nothing written\n`)
    return 0
  }

  let result: Awaited<ReturnType<Adapter['apply']>>
  try {
    result = await adapter.apply(items, input)
  } catch (e) {
    process.stderr.write(`handoff: ${(e as Error).message}\n`)
    return 1
  }

  const emitted = items.reduce((n, i) => n + i.frs.length, 0)
  const confirmed = input.requirements.filter((r) => r.confidence.kind === 'confirmed').length
  const file: HandoffFile = {
    version: 1,
    adapter: name,
    items: items.map(({ key, title, frs, dependsOn, weight }) => ({
      key,
      title,
      frs,
      dependsOn,
      weight,
    })),
    refs: result.refs,
    basis: { confirmed, emitted, order: items.map((i) => i.key) },
  }

  await withStoreLock(
    opts.root,
    async () => {
      await saveHandoff(opts.root, file, cfg.source.path)
      await recordBatch(
        opts.root,
        'handoff',
        { id: `b-handoff-${name}`, count: items.length },
        cfg.source.path,
      )
    },
    { cmd: 'handoff', ...(opts.forceUnlock ? { force: true } : {}) },
  )

  process.stdout.write(
    `handoff: adapter ${name}, ${items.length} work item(s), ${emitted} requirement(s)\n` +
      `  created   ${result.created.length}\n` +
      `  updated   ${result.updated.length}\n` +
      `  unchanged ${result.unchanged.length}\n` +
      `next: mark the phase done with \`migrate phase handoff --status done\`, then read progress back with \`migrate coverage\`\n`,
  )
  return 0
}
