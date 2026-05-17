import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export type FetchPrInput = {
  ghBin: string
  prNumber: number
  runDir: string
}

export type FetchPrResult =
  | { ok: true; prJsonPath: string; diffPath: string }
  | { ok: false; error: string }

const PR_VIEW_FIELDS = [
  'number',
  'title',
  'headRefName',
  'baseRefName',
  'headRefOid',
  'baseRefOid',
  'author',
  'body',
  // `url` is included so server-side posting can parse owner/repo without
  // depending on cwd (the worktree is gone after cleanup).
  'url',
].join(',')

export async function fetchPr(input: FetchPrInput): Promise<FetchPrResult> {
  const { ghBin, prNumber, runDir } = input
  const view = Bun.spawn([ghBin, 'pr', 'view', String(prNumber), '--json', PR_VIEW_FIELDS], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const viewStdout = await new Response(view.stdout).text()
  const viewStderr = await new Response(view.stderr).text()
  const viewExit = await view.exited
  if (viewExit !== 0) {
    return {
      ok: false,
      error: `gh pr view exit ${viewExit}: ${viewStderr.trim()}`,
    }
  }

  const diff = Bun.spawn([ghBin, 'pr', 'diff', String(prNumber)], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const diffStdout = await new Response(diff.stdout).text()
  const diffStderr = await new Response(diff.stderr).text()
  const diffExit = await diff.exited
  if (diffExit !== 0) {
    return {
      ok: false,
      error: `gh pr diff exit ${diffExit}: ${diffStderr.trim()}`,
    }
  }

  const prJsonPath = join(runDir, 'pr.json')
  const diffPath = join(runDir, 'diff.patch')
  await writeFile(prJsonPath, viewStdout)
  await writeFile(diffPath, diffStdout)
  return { ok: true, prJsonPath, diffPath }
}
