import { existsSync } from 'node:fs'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { writeConfig } from './config.ts'
import { storePaths } from './paths.ts'

const ENV_IGNORE = '.migrate/.env'

export async function runInit(opts: {
  root: string
  sourcePath: string
  scope: string
  targetName: string
  sourceStack?: string
  targetStack?: string
  vcs?: string
  basis?: string
}): Promise<number> {
  const sourcePath = isAbsolute(opts.sourcePath) ? opts.sourcePath : resolve(opts.sourcePath)
  if (!existsSync(sourcePath)) {
    process.stderr.write(`init: source path does not exist: ${sourcePath}\n`)
    return 2
  }
  const basis = opts.basis ?? 'source-only'
  if (basis !== 'runnable' && basis !== 'source-only') {
    process.stderr.write(`init: --basis must be runnable or source-only, got ${basis}\n`)
    return 2
  }

  const paths = storePaths(opts.root)
  if (existsSync(paths.config)) {
    process.stderr.write(`init: ${paths.config} already exists; edit it or remove it first\n`)
    return 1
  }

  await mkdir(paths.queueDir, { recursive: true })
  await writeConfig(opts.root, {
    sourcePath,
    scope: opts.scope,
    targetName: opts.targetName,
    ...(opts.sourceStack ? { sourceStack: opts.sourceStack } : {}),
    ...(opts.targetStack ? { targetStack: opts.targetStack } : {}),
    vcs: opts.vcs ?? (existsSync(join(sourcePath, '.git')) ? 'git' : 'none'),
    basis,
  })

  const gitignore = join(opts.root, '.gitignore')
  if (existsSync(gitignore)) {
    const text = await readFile(gitignore, 'utf8')
    if (!text.includes(ENV_IGNORE)) {
      const prefix = text.endsWith('\n') || text.length === 0 ? '' : '\n'
      await appendFile(gitignore, `${prefix}${ENV_IGNORE}\n`)
    }
  }

  process.stdout.write(`init: wrote ${paths.config}\n`)
  process.stdout.write('next: run the enumerate phase, then `migrate check`\n')
  return 0
}
