#!/usr/bin/env bun

import pkg from '../package.json' with { type: 'json' }

const VERSION = (pkg as { version: string }).version

const USAGE = `Usage: migrate <subcommand> [args]

Subcommands:
  init --source <path> --scope <text> --name <target>
                                  Write .migrate/config.toml
  import <elements|reqs|deltas> <batch.json>
                                  Validated bulk append to the store
  census <record.json>            Record a lens accounting record
  queue add <file.md>             Add a queue item
  queue list [--open]             List queue items, severity first
  queue show <id>                 Print one queue item
  check [--citations] [--leaks]   Run the gates
  status                          Phase state, counts, resume pointer
  reset --phase <phase>           Clear one phase's derived rows
  report [--out <dir>]            Render markdown views
  --version                       Print the migrate version
  --help                          Show this message`

type Handler = (args: string[]) => Promise<number> | number

const HANDLERS: Record<string, Handler> = {
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
    const { runImport } = await import('../scripts/import-cmd.ts')
    return runImport({ root, kind, batchFile: file })
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
    const { runCensus } = await import('../scripts/census-cmd.ts')
    return runCensus({ root, file })
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
  check: async (args) => {
    const { findStoreRoot } = await import('../scripts/paths.ts')
    const root = await findStoreRoot(process.cwd())
    if (!root) {
      process.stderr.write('check: no .migrate store found above the cwd\n')
      return 2
    }
    const { runCheckCmd } = await import('../scripts/check-cmd.ts')
    return runCheckCmd({
      root,
      citations: args.includes('--citations'),
      leaks: args.includes('--leaks'),
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
    const at = args.indexOf('--phase')
    const phase = at !== -1 ? args[at + 1] : undefined
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
    const { runReset } = await import('../scripts/reset-cmd.ts')
    return runReset({ root, phase })
  },
}

async function main(argv: string[]): Promise<number> {
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
    process.stderr.write(`${sub}: ${(e as Error).message}\n`)
    return 2
  }
}

const code = await main(process.argv.slice(2))
process.exit(code)
