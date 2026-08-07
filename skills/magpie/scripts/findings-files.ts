/**
 * A specialist writes `findings/<focus>.json`, or `findings/<focus>.shard-<n>.json`
 * when stage 4 fanned the focus out across shards. Returns null for anything
 * else, which the caller logs and skips.
 */
export function parseFindingsFilename(
  name: string,
): { focus: string; shard: number | null } | null {
  if (!name.endsWith('.json')) return null
  const stem = name.slice(0, -'.json'.length)
  const parts = stem.split('.')
  const focus = parts[0]
  if (!focus) return null
  if (parts.length === 1) return { focus, shard: null }
  if (parts.length > 2) return null
  const m = /^shard-(\d+)$/.exec(parts[1] ?? '')
  if (!m) return null
  return { focus, shard: Number(m[1]) }
}

/**
 * Every shard's security specialist mints `security-1` for its first finding,
 * so a five-shard run yields five findings sharing one id, and the report and
 * post stages key on id. Rewriting deterministically here beats asking five
 * prompts to encode the shard themselves.
 */
export function namespaceId(id: string, focus: string, shard: number | null): string {
  if (shard === null) return id
  const tag = `s${shard}`
  const prefix = `${focus}-`
  return id.startsWith(prefix) ? `${prefix}${tag}-${id.slice(prefix.length)}` : `${tag}-${id}`
}
