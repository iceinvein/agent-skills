export type Deps = {
  bun: string
  gh: string
  codex: string
  git: string
}

export type PreflightResult = {
  ok: boolean
  missing: string[]
  resolved: Record<keyof Deps, string | null>
}

export async function preflight(deps: Deps): Promise<PreflightResult> {
  const resolved: Record<keyof Deps, string | null> = {
    bun: Bun.which(deps.bun),
    gh: Bun.which(deps.gh),
    codex: Bun.which(deps.codex),
    git: Bun.which(deps.git),
  }
  const missing = (Object.keys(resolved) as Array<keyof Deps>).filter((k) => resolved[k] === null)
  return { ok: missing.length === 0, missing, resolved }
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
    bun: process.env.PR_REVIEW_BUN_BIN || 'bun',
    gh: process.env.PR_REVIEW_GH_BIN || 'gh',
    codex: process.env.PR_REVIEW_CODEX_BIN || 'codex',
    git: process.env.PR_REVIEW_GIT_BIN || 'git',
  }
}
