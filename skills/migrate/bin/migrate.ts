#!/usr/bin/env bun

import pkg from '../package.json' with { type: 'json' }

const VERSION = (pkg as { version: string }).version

const USAGE = `Usage: migrate <subcommand> [args]

Subcommands:
  init --source <path> --scope <text> --name <target>
                                  Write .migrate/config.toml
  import <elements|reqs|deltas> <batch.json> [--force-unlock]
                                  Validated bulk append to the store
  census <record.json> [--force-unlock]
                                  Record a lens accounting record
  phase [<name>] [--status <s>] [--force-unlock]
                                  Print phase state, or set one phase's status
  queue add <file.md>             Add a queue item
  queue list [--open]             List queue items, severity first
  queue show <id>                 Print one queue item
  adjudicate [<id>] [--ruling <text>] [--force] [--force-unlock]
                                  Print the review sheet, or record one ruling
  check [--phase <p>] [--no-citations] [--leaks]
                                  Run the gates; without --phase, exit 0 means
                                  the whole migration is complete
  status                          Phase state, counts, resume pointer
  reset --phase <phase> [--force-unlock]
                                  Clear one phase's derived rows
  report [--out <dir>]            Render markdown views
  --version                       Print the migrate version
  --help                          Show this message`

type Handler = (args: string[]) => Promise<number> | number

// A flag's value is missing, or the value slot is occupied by another flag
// (`init --scope --name newapp` used to read scope as the literal string
// "--name" and carry on), in both cases the request is malformed, not a
// value the command can act on. Every `--flag <value>` parser in this file
// shares this one check so the three no longer disagree about which of
// those two shapes is a usage error and which is silently tolerated.
function readFlag(args: string[], name: string): { value?: string; error?: string } {
  const at = args.indexOf(name)
  if (at === -1) return {}
  const value = args[at + 1]
  if (value === undefined || value.startsWith('--')) {
    return { error: `${name} needs a value` }
  }
  return { value }
}

const HANDLERS: Record<string, Handler> = {
  init: async (args) => {
    const names = ['--source', '--scope', '--name', '--source-stack', '--target-stack', '--basis']
    const values: Record<string, string | undefined> = {}
    for (const name of names) {
      const result = readFlag(args, name)
      if (result.error) {
        process.stderr.write(`init: ${result.error}\n`)
        return 2
      }
      values[name] = result.value
    }
    const sourcePath = values['--source']
    const scope = values['--scope']
    const targetName = values['--name']
    if (!sourcePath || !scope || !targetName) {
      process.stderr.write(
        'init: want --source <path> --scope <text> --name <target> [--source-stack <s>] [--target-stack <s>] [--basis <runnable|source-only>]\n',
      )
      return 2
    }
    const { runInit } = await import('../scripts/init-cmd.ts')
    return runInit({
      root: process.cwd(),
      sourcePath,
      scope,
      targetName,
      ...(values['--source-stack'] ? { sourceStack: values['--source-stack'] } : {}),
      ...(values['--target-stack'] ? { targetStack: values['--target-stack'] } : {}),
      ...(values['--basis'] ? { basis: values['--basis'] } : {}),
    })
  },
  import: async (args) => {
    const kind = args[0]
    const file = args[1]
    if (kind !== 'elements' && kind !== 'reqs' && kind !== 'deltas') {
      process.stderr.write('import: want <elements|reqs|deltas> <batch.json>\n')
      return 2
    }
    if (!file) {
      process.stderr.write('import: missing <batch.json>\n')
      return 2
    }
    const { findStoreRoot } = await import('../scripts/paths.ts')
    const root = await findStoreRoot(process.cwd())
    if (!root) {
      process.stderr.write('import: no .migrate store found above the cwd\n')
      return 2
    }
    const forceUnlock = args.includes('--force-unlock')
    const { runImport } = await import('../scripts/import-cmd.ts')
    return runImport({
      root,
      kind,
      batchFile: file,
      ...(forceUnlock ? { forceUnlock: true } : {}),
    })
  },
  census: async (args) => {
    const file = args[0]
    if (!file) {
      process.stderr.write('census: missing <record.json>\n')
      return 2
    }
    const { findStoreRoot } = await import('../scripts/paths.ts')
    const root = await findStoreRoot(process.cwd())
    if (!root) {
      process.stderr.write('census: no .migrate store found above the cwd\n')
      return 2
    }
    const forceUnlock = args.includes('--force-unlock')
    const { runCensus } = await import('../scripts/census-cmd.ts')
    return runCensus({ root, file, ...(forceUnlock ? { forceUnlock: true } : {}) })
  },
  phase: async (args) => {
    const status = readFlag(args, '--status')
    if (status.error) {
      process.stderr.write(`phase: ${status.error}\n`)
      return 2
    }
    // args[0] is the phase name only when it is a positional. A flag sitting
    // in that slot (`phase --force-unlock enumerate --status done`) leaves the
    // name undefined, which used to silently downgrade a write to a read:
    // every phase's line printed, exit 0, nothing moved. `import` and `census`
    // both reject the identical flag-ordering mistake at 2, because their
    // first positional is load-bearing too. Any write-intent flag with no
    // phase name to apply it to is that same mistake, so it is refused here
    // rather than serviced as a listing nobody asked for.
    const name = args[0]?.startsWith('--') ? undefined : args[0]
    if (!name && (status.value !== undefined || args.includes('--force-unlock'))) {
      process.stderr.write(
        'phase: want <name> before --status/--force-unlock, as in `phase enumerate --status done`\n',
      )
      return 2
    }
    const { findStoreRoot } = await import('../scripts/paths.ts')
    const root = await findStoreRoot(process.cwd())
    if (!root) {
      process.stderr.write('phase: no .migrate store found above the cwd\n')
      return 2
    }
    const forceUnlock = args.includes('--force-unlock')
    const { runPhase } = await import('../scripts/phase-cmd.ts')
    return runPhase({
      root,
      ...(name ? { name } : {}),
      ...(status.value ? { status: status.value } : {}),
      ...(forceUnlock ? { forceUnlock: true } : {}),
    })
  },
  queue: async (args) => {
    const { findStoreRoot } = await import('../scripts/paths.ts')
    const root = await findStoreRoot(process.cwd())
    if (!root) {
      process.stderr.write('queue: no .migrate store found above the cwd\n')
      return 2
    }
    const { runQueue } = await import('../scripts/queue-cmd.ts')
    return runQueue({ root, args })
  },
  adjudicate: async (args) => {
    const ruling = readFlag(args, '--ruling')
    if (ruling.error) {
      process.stderr.write(`adjudicate: ${ruling.error}\n`)
      return 2
    }
    // Same rule as `phase`: a flag sitting in the first positional slot leaves
    // the id undefined, which would silently downgrade a write to a listing
    // nobody asked for. Any write-intent flag with no id to apply it to is
    // that mistake, so it is refused rather than serviced.
    const id = args[0]?.startsWith('--') ? undefined : args[0]
    if (!id && (ruling.value !== undefined || args.includes('--force'))) {
      process.stderr.write(
        'adjudicate: want <id> before --ruling/--force, as in `adjudicate q-x --ruling "..."`\n',
      )
      return 2
    }
    const { findStoreRoot } = await import('../scripts/paths.ts')
    const root = await findStoreRoot(process.cwd())
    if (!root) {
      process.stderr.write('adjudicate: no .migrate store found above the cwd\n')
      return 2
    }
    const { runAdjudicate } = await import('../scripts/adjudicate-cmd.ts')
    return runAdjudicate({
      root,
      ...(id ? { id } : {}),
      ...(ruling.value !== undefined ? { ruling: ruling.value } : {}),
      ...(args.includes('--force') ? { force: true } : {}),
      ...(args.includes('--force-unlock') ? { forceUnlock: true } : {}),
    })
  },
  check: async (args) => {
    const phase = readFlag(args, '--phase')
    if (phase.error) {
      process.stderr.write(`check: ${phase.error}\n`)
      return 2
    }
    const { isPhase, PHASES } = await import('../scripts/phases.ts')
    if (phase.value && !isPhase(phase.value)) {
      process.stderr.write(
        `check: unknown phase ${phase.value}; want one of ${PHASES.join(', ')}\n`,
      )
      return 2
    }
    const { findStoreRoot } = await import('../scripts/paths.ts')
    const root = await findStoreRoot(process.cwd())
    if (!root) {
      process.stderr.write('check: no .migrate store found above the cwd\n')
      return 2
    }
    const { runCheckCmd } = await import('../scripts/check-cmd.ts')
    return runCheckCmd({
      root,
      // --citations is accepted and ignored: citations are on by default now,
      // and silently rejecting the old flag would break every invocation
      // written against Milestone 1.
      citations: !args.includes('--no-citations'),
      leaks: args.includes('--leaks'),
      ...(phase.value && isPhase(phase.value) ? { phase: phase.value } : {}),
    })
  },
  status: async () => {
    const { findStoreRoot } = await import('../scripts/paths.ts')
    const root = await findStoreRoot(process.cwd())
    if (!root) {
      process.stderr.write('status: no .migrate store found above the cwd\n')
      return 2
    }
    const { runStatus } = await import('../scripts/status-cmd.ts')
    return runStatus({ root })
  },
  reset: async (args) => {
    const result = readFlag(args, '--phase')
    if (result.error) {
      process.stderr.write(`reset: ${result.error}\n`)
      return 2
    }
    const phase = result.value
    if (!phase) {
      process.stderr.write('reset: missing --phase <phase>\n')
      return 2
    }
    const { findStoreRoot } = await import('../scripts/paths.ts')
    const root = await findStoreRoot(process.cwd())
    if (!root) {
      process.stderr.write('reset: no .migrate store found above the cwd\n')
      return 2
    }
    const forceUnlock = args.includes('--force-unlock')
    const { runReset } = await import('../scripts/reset-cmd.ts')
    return runReset({ root, phase, ...(forceUnlock ? { forceUnlock: true } : {}) })
  },
  report: async (args) => {
    const result = readFlag(args, '--out')
    if (result.error) {
      process.stderr.write(`report: ${result.error}\n`)
      return 2
    }
    const outDir = result.value
    const { findStoreRoot } = await import('../scripts/paths.ts')
    const root = await findStoreRoot(process.cwd())
    if (!root) {
      process.stderr.write('report: no .migrate store found above the cwd\n')
      return 2
    }
    const { runReport } = await import('../scripts/report-cmd.ts')
    return runReport({ root, ...(outDir ? { outDir } : {}) })
  },
}

// A handler's rejection reaching the guard below is not guaranteed to be an
// Error: `(e as Error).message` on a non-Error rejection prints the useless
// "sub: undefined", and on a rejected `null` or `undefined` it throws inside
// the catch itself -- the one shape that would otherwise still escape this
// guard uncaught. Every other value (a string, a plain object, an Error)
// converts to a message without throwing.
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export async function main(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv
  if (sub === '--help' || sub === '-h') {
    process.stdout.write(`${USAGE}\n`)
    return 0
  }
  if (sub === '--version' || sub === '-V') {
    process.stdout.write(`migrate ${VERSION}\n`)
    return 0
  }
  if (!sub) {
    process.stderr.write(`${USAGE}\n`)
    return 2
  }
  const handler = HANDLERS[sub]
  if (!handler) {
    process.stderr.write(`Unknown subcommand: ${sub}\n${USAGE}\n`)
    return 2
  }
  try {
    return await handler(rest)
  } catch (e) {
    // Every failure a handler recognizes already returns its own exit code
    // without throwing (see import-cmd.ts, census-cmd.ts, queue-cmd.ts,
    // check-cmd.ts). An Error reaching here is one none of them classified,
    // and in this codebase that is dominated by one shape: loadConfig
    // throwing because config.toml is missing or malformed, unguarded at
    // its import-cmd.ts, census-cmd.ts, queue-cmd.ts and check.ts call
    // sites, or an equivalent case where the store itself cannot be read
    // (a corrupt phases.json, a malformed row in an existing store file).
    // Every one of those means the request could never have been serviced
    // as posed, not that a well-formed request turned up a bad answer, so
    // it takes the same code already used a few lines up for "no .migrate
    // store found above the cwd" and, in every handler, for the
    // assertNotUnderSource containment refusal: 2, not 1. The message
    // printed is the Error's own message (never a generic replacement, so a
    // genuine bug is still visible), prefixed the way every handler prefixes
    // its own diagnostics, and nothing else: no stack trace.
    process.stderr.write(`${sub}: ${errorMessage(e)}\n`)
    return 2
  }
}

// Guarded so this module can be imported (e.g. by tests, to exercise `main`
// and `errorMessage` directly) without re-running the CLI against the
// importing process's own argv and calling process.exit out from under it.
// Running `bun bin/migrate.ts ...` directly still takes this branch exactly
// as before.
if (import.meta.main) {
  const code = await main(process.argv.slice(2))
  process.exit(code)
}
