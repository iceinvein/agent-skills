import { readFile, realpath } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import type { Requirement, Violation } from './types.ts'

async function lineCount(path: string, cache: Map<string, number>): Promise<number> {
  const cached = cache.get(path)
  if (cached !== undefined) return cached
  const text = await readFile(path, 'utf8')
  // A trailing newline does not add a line: "a\nb\n" is two lines.
  const count = text.length === 0 ? 0 : text.replace(/\n$/, '').split('\n').length
  cache.set(path, count)
  return count
}

export async function resolveCitations(
  reqs: Requirement[],
  sourcePath: string,
): Promise<Violation[]> {
  const violations: Violation[] = []
  const cache = new Map<string, number>()
  const sourceRoot = resolve(sourcePath)
  let realSourceRoot: string
  try {
    realSourceRoot = await realpath(sourceRoot)
  } catch {
    // If sourceRoot itself cannot be resolved, fail cleanly
    return [{ gate: 'citations', message: 'source path does not exist' }]
  }

  for (const req of reqs) {
    for (const ref of req.citations) {
      if (ref.kind !== 'src') continue

      // Reject absolute paths
      if (ref.path.startsWith('/') || /^[a-z]:/i.test(ref.path)) {
        violations.push({
          gate: 'citations',
          message: `${req.id} cites ${ref.path}, which is an absolute path; citations must use relative paths`,
        })
        continue
      }

      const abs = resolve(join(sourceRoot, ref.path))
      const rel = relative(sourceRoot, abs)
      if (rel.startsWith(`..${sep}`) || rel === '..') {
        violations.push({
          gate: 'citations',
          message: `${req.id} cites ${ref.path}, which is outside the source tree`,
        })
        continue
      }

      // Resolve real path (following symlinks, detecting broken ones)
      let realPath: string
      try {
        realPath = await realpath(abs)
      } catch {
        violations.push({
          gate: 'citations',
          message: `${req.id} cites ${ref.path}, which does not exist in the source tree`,
        })
        continue
      }

      // Check containment of the real path against the real sourceRoot
      const realRel = relative(realSourceRoot, realPath)
      if (realRel.startsWith(`..${sep}`) || realRel === '..') {
        violations.push({
          gate: 'citations',
          message: `${req.id} cites ${ref.path}, which is outside the source tree`,
        })
        continue
      }

      if (ref.lines) {
        const total = await lineCount(realPath, cache)
        const [start, end] = ref.lines
        if (start > end) {
          violations.push({
            gate: 'citations',
            message: `${req.id} cites ${ref.path}:${start}-${end} but the range is inverted`,
          })
        } else if (start < 1 || end > total) {
          violations.push({
            gate: 'citations',
            message: `${req.id} cites ${ref.path}:${start}-${end} but the file has ${total} line(s)`,
          })
        }
      }
    }
  }
  return violations
}
