import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdtemp, realpath, rm, stat, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export type LocalBranchDiffInput = {
  gitBin: string
  repoPath: string
  baseRef?: string
}

export type LocalBranchDiffResult =
  | { ok: true; diff: string; baseRef: string; mergeBase: string; head: string }
  | { ok: false; error: string }

export type LocalMeta = {
  branch: string | null
  baseRef: string
  mergeBase: string
  head: string
  dirty: boolean
  author: string
  commits: Array<{ oid: string; headline: string; body: string }>
  intentFile: string | null
}

export type LocalBranchMetaInput = {
  gitBin: string
  repoPath: string
  baseRef: string
  mergeBase: string
  head: string
  intentFile: string | null
}

export type LocalBranchMetaResult = { ok: true; meta: LocalMeta } | { ok: false; error: string }

async function git(
  gitBin: string,
  cwd: string,
  args: string[],
  extraEnv: Record<string, string> = {},
): Promise<{ exit: number; stdout: string; stderr: string }> {
  // Bun.spawn snapshots the env at startup unless given one, so pass the live
  // env to honour GIT_CONFIG_* or HOME set after launch. GIT_OPTIONAL_LOCKS=0
  // stops status refreshing the caller's index. quotePath=false keeps
  // non-ASCII paths readable by the downstream header parsers.
  const proc = Bun.spawn([gitBin, '-c', 'core.quotePath=false', ...args], {
    cwd,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', ...extraEnv },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  const exit = await proc.exited
  return { exit, stdout, stderr }
}

// Pin the patch format against user config (noprefix, mnemonicPrefix, external
// diff drivers, textconv) so the downstream parsers always see git's default.
const DIFF_FORMAT = [
  '--no-color',
  '--no-ext-diff',
  '--no-textconv',
  '--src-prefix=a/',
  '--dst-prefix=b/',
]

async function resolveCommit(gitBin: string, cwd: string, ref: string): Promise<string | null> {
  const r = await git(gitBin, cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
  const sha = r.stdout.trim()
  return r.exit === 0 && sha.length > 0 ? sha : null
}

/**
 * Diff the checked-out branch against its merge base with `baseRef`, including
 * uncommitted edits and untracked (non-ignored) files. Read-only: untracked
 * files go through `--no-index` rather than `git add -N`, so the caller's index
 * is never touched, and nothing is fetched.
 */
export async function localBranchDiff(input: LocalBranchDiffInput): Promise<LocalBranchDiffResult> {
  const { gitBin, repoPath } = input
  const baseRef = input.baseRef ?? 'origin/HEAD'

  const top = await git(gitBin, repoPath, ['rev-parse', '--show-toplevel'])
  if (top.exit !== 0) {
    return { ok: false, error: `${repoPath} is not a git repository: ${top.stderr.trim()}` }
  }
  const toplevel = top.stdout.trim()
  if ((await realpath(toplevel)) !== (await realpath(repoPath))) {
    return { ok: false, error: `${repoPath} is not the repository root (${toplevel})` }
  }

  const base = await resolveCommit(gitBin, repoPath, baseRef)
  if (!base) return { ok: false, error: `cannot resolve base ref ${baseRef} to a commit` }

  const head = await resolveCommit(gitBin, repoPath, 'HEAD')
  if (!head) return { ok: false, error: 'cannot resolve HEAD to a commit' }

  const mb = await git(gitBin, repoPath, ['merge-base', base, head])
  const mergeBase = mb.stdout.trim()
  if (mb.exit !== 0 || !mergeBase) {
    return { ok: false, error: `no merge base between ${baseRef} and HEAD: ${mb.stderr.trim()}` }
  }

  const indexPath = await git(gitBin, repoPath, ['rev-parse', '--git-path', 'index'])
  if (indexPath.exit !== 0) {
    return { ok: false, error: `git rev-parse --git-path index failed: ${indexPath.stderr.trim()}` }
  }
  const realIndex = resolve(repoPath, indexPath.stdout.trim())
  const scratch = await mkdtemp(join(tmpdir(), 'magpie-index-'))
  let tracked: { exit: number; stdout: string; stderr: string }
  try {
    // git refreshes stat info into the index on `git diff <commit>` regardless
    // of optional locks, so that diff runs against a throwaway copy.
    const indexEnv: Record<string, string> = {}
    if (existsSync(realIndex)) {
      const copy = join(scratch, 'index')
      // git trusts cached stat data only for files older than the index file,
      // so a fresh mtime on the copy would hide same-second edits. The stat
      // comes first so a concurrent index rewrite can only pair newer bytes
      // with an older mtime, which makes git recheck more, not less.
      const original = await stat(realIndex)
      await copyFile(realIndex, copy)
      await utimes(copy, original.atime, original.mtime)
      indexEnv.GIT_INDEX_FILE = copy
    }
    tracked = await git(
      gitBin,
      repoPath,
      ['diff', ...DIFF_FORMAT, '--find-renames', mergeBase],
      indexEnv,
    )
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
  if (tracked.exit !== 0) {
    return { ok: false, error: `git diff ${mergeBase} failed: ${tracked.stderr.trim()}` }
  }

  const others = await git(gitBin, repoPath, ['ls-files', '--others', '--exclude-standard', '-z'])
  if (others.exit !== 0) {
    return { ok: false, error: `git ls-files failed: ${others.stderr.trim()}` }
  }
  const untracked = others.stdout.split('\0').filter((p) => p.length > 0)

  let diff = tracked.stdout
  for (const path of untracked) {
    // `--no-index` exits 1 when the files differ, which is always the case here.
    const r = await git(gitBin, repoPath, [
      'diff',
      ...DIFF_FORMAT,
      '--no-index',
      '--',
      '/dev/null',
      path,
    ])
    if (r.exit !== 1) {
      return {
        ok: false,
        error: `git diff --no-index ${path} exited ${r.exit}: ${r.stderr.trim()}`,
      }
    }
    diff += r.stdout
  }

  if (diff.length === 0) return { ok: false, error: `nothing to review against ${baseRef}` }
  return { ok: true, diff, baseRef, mergeBase, head }
}

export async function localBranchMeta(input: LocalBranchMetaInput): Promise<LocalBranchMetaResult> {
  const { gitBin, repoPath, baseRef, mergeBase, head, intentFile } = input

  // Exit 1 with no output is a detached HEAD, not an error.
  const sym = await git(gitBin, repoPath, ['symbolic-ref', '--short', '-q', 'HEAD'])
  if (sym.exit !== 0 && sym.exit !== 1) {
    return { ok: false, error: `git symbolic-ref failed: ${sym.stderr.trim()}` }
  }
  const branch = sym.exit === 0 ? sym.stdout.trim() : null

  const status = await git(gitBin, repoPath, ['status', '--porcelain'])
  if (status.exit !== 0) return { ok: false, error: `git status failed: ${status.stderr.trim()}` }

  const name = await git(gitBin, repoPath, ['config', 'user.name'])
  const author = name.stdout.trim()
  if (name.exit !== 0 || !author) {
    return { ok: false, error: 'git config user.name is not set; set it and retry' }
  }

  const log = await git(gitBin, repoPath, [
    'log',
    '--format=%H%x1f%s%x1f%b%x1e',
    `${mergeBase}..${head}`,
  ])
  if (log.exit !== 0) return { ok: false, error: `git log failed: ${log.stderr.trim()}` }
  const commits: LocalMeta['commits'] = []
  for (const record of log.stdout.split('\x1e')) {
    const trimmed = record.replace(/^\n/, '')
    if (!trimmed) continue
    const [oid, headline, body] = trimmed.split('\x1f')
    if (oid === undefined || headline === undefined || body === undefined) {
      return { ok: false, error: `malformed git log record: ${JSON.stringify(trimmed)}` }
    }
    commits.push({ oid, headline, body: body.trim() })
  }

  return {
    ok: true,
    meta: {
      branch,
      baseRef,
      mergeBase,
      head,
      dirty: status.stdout.trim().length > 0,
      author,
      commits,
      intentFile,
    },
  }
}

export function diffSha256(diff: string): string {
  return createHash('sha256').update(diff, 'utf8').digest('hex')
}
