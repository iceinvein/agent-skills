export type Deps = {
  bun: string
  gh: string
  codex: string
  git: string
}

export type PreflightResult = {
  ok: boolean
  /** Required binaries that did not resolve; any entry here aborts the run. */
  missing: string[]
  /** Optional binaries that did not resolve; these only degrade features, they never abort. */
  missingOptional: string[]
  resolved: Record<keyof Deps, string | null>
}

// codex only powers the optional peer-review stage; a missing codex degrades that
// stage to skipped rather than blocking the whole run.
const OPTIONAL_DEPS: ReadonlySet<keyof Deps> = new Set<keyof Deps>(['codex'])

export async function preflight(deps: Deps): Promise<PreflightResult> {
  const resolved: Record<keyof Deps, string | null> = {
    bun: Bun.which(deps.bun),
    gh: Bun.which(deps.gh),
    codex: Bun.which(deps.codex),
    git: Bun.which(deps.git),
  }
  const unresolved = (Object.keys(resolved) as Array<keyof Deps>).filter(
    (k) => resolved[k] === null,
  )
  const missing = unresolved.filter((k) => !OPTIONAL_DEPS.has(k))
  const missingOptional = unresolved.filter((k) => OPTIONAL_DEPS.has(k))
  return { ok: missing.length === 0, missing, missingOptional, resolved }
}

const HINTS: Record<string, string> = {
  bun: 'bun: install from https://bun.sh',
  gh: 'gh: install from https://cli.github.com (run `gh auth login` after)',
  codex: 'codex: install the Codex CLI per Codex docs (run `codex auth login` after)',
  git: 'git: install via your package manager',
}

export function renderInstallHint(missing: string[]): string {
  return missing.map((m) => HINTS[m] ?? `${m}: not found on PATH`).join('\n')
}

export function defaultDeps(): Deps {
  return {
    bun: process.env.MAGPIE_BUN_BIN || 'bun',
    gh: process.env.MAGPIE_GH_BIN || 'gh',
    codex: process.env.MAGPIE_CODEX_BIN || 'codex',
    git: process.env.MAGPIE_GIT_BIN || 'git',
  }
}
