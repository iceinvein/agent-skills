import { existsSync, statSync } from 'node:fs'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { writeConfig } from './config.ts'
import { assertNotUnderSource, storePaths } from './paths.ts'

const ENV_IGNORE = '.migrate/.env'

// A real ignore entry is a whole line, not any line containing the string as a
// substring: a comment mentioning the path, or an unrelated deeper path such as
// foo/.migrate/.env, must not be mistaken for the real entry.
function gitignoreListsEnvFile(text: string): boolean {
  return text.split('\n').some((line) => {
    const trimmed = line.trim()
    return trimmed.length > 0 && !trimmed.startsWith('#') && trimmed === ENV_IGNORE
  })
}

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
  if (!statSync(sourcePath).isDirectory()) {
    process.stderr.write(`init: source path is not a directory: ${sourcePath}\n`)
    return 2
  }
  const basis = opts.basis ?? 'source-only'
  if (basis !== 'runnable' && basis !== 'source-only') {
    process.stderr.write(`init: --basis must be runnable or source-only, got ${basis}\n`)
    return 2
  }

  const paths = storePaths(opts.root)
  const gitignore = join(opts.root, '.gitignore')

  // Every other command reaches the source path through a store that already
  // exists, so its writers inherit the containment guard from the helper they
  // write through. `init` is the command that creates that store, and it had
  // no guard at all: pointing --source at a directory containing the target
  // produced a config.toml, a queue directory and a .gitignore edit inside the
  // read-only source tree, after which every later command exited 2 on the
  // guard those writers do have. The user was left with a store nothing could
  // write to, three shipped documents having promised this was impossible.
  //
  // All three write targets are checked here, before anything is created, so a
  // refusal leaves the tree exactly as it was found rather than half-built.
  // Reported and returned rather than thrown, matching how import-cmd.ts and
  // census-cmd.ts already classify this same refusal: a request that could
  // never be serviced as posed is a usage error (2), not a content failure.
  // The check runs ahead of the existing-config check below because a config
  // already sitting inside the source tree is itself the wreckage of this bug,
  // and "that store can never work" is the more useful thing to say about it
  // than "that file is already there".
  for (const target of [paths.config, paths.queueDir, gitignore]) {
    try {
      await assertNotUnderSource(target, sourcePath)
    } catch (e) {
      process.stderr.write(`init: ${(e as Error).message}\n`)
      return 2
    }
  }

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

  process.stdout.write(`init: wrote ${paths.config}\n`)

  // The append branch used to be the whole of this: a target repo with no
  // .gitignore of its own got no ignore entry, so the first `git add -A` of
  // the run staged .migrate/.env -- the one file in the store most likely to
  // hold credentials, in the one place (a fresh target, first commit) where
  // nobody has looked at the ignore rules yet. The `leaks` gate that would
  // catch the committed result is opt-in, so nothing else stands behind this.
  // Creating the file closes that.
  //
  // Both branches say what they did on stdout. init writing or editing a file
  // outside .migrate/ that the caller did not name is worth one line either
  // way; a silent edit to a .gitignore the caller already maintains is no more
  // discoverable than a silent creation.
  if (existsSync(gitignore)) {
    const text = await readFile(gitignore, 'utf8')
    if (!gitignoreListsEnvFile(text)) {
      const prefix = text.endsWith('\n') || text.length === 0 ? '' : '\n'
      await appendFile(gitignore, `${prefix}${ENV_IGNORE}\n`)
      process.stdout.write(`init: appended ${ENV_IGNORE} to ${gitignore}\n`)
    }
  } else {
    await writeFile(gitignore, `${ENV_IGNORE}\n`)
    process.stdout.write(`init: created ${gitignore} with ${ENV_IGNORE}\n`)
  }

  process.stdout.write('next: run the enumerate phase, then `migrate check`\n')
  return 0
}
