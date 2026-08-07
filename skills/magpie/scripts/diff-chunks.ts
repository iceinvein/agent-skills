export type FileChunk = { path: string; text: string; lines: number }

export const FILE_HEADER = /^diff --git a\/(.+?) b\/(.+?)$/m

/** Split a unified diff on file boundaries. The first element may be a preamble
 *  that is not a file chunk; callers decide what to do with it. */
export function splitRawChunks(diff: string): string[] {
  return diff.split(/^(?=diff --git )/m)
}

/** The b-side path of a file chunk, falling back to the a-side for deletions. */
export function chunkPath(chunk: string): string | null {
  const m = chunk.match(FILE_HEADER)
  return m?.[2] ?? m?.[1] ?? null
}

/** File chunks only, with their paths and patch-line counts resolved. */
export function splitFileChunks(diff: string): FileChunk[] {
  if (!diff.trim()) return []
  const out: FileChunk[] = []
  for (const chunk of splitRawChunks(diff)) {
    if (!chunk.startsWith('diff --git ')) continue
    const path = chunkPath(chunk)
    if (!path) continue
    out.push({ path, text: chunk, lines: chunk.split('\n').length })
  }
  return out
}
