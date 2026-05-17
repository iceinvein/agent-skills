import type { ReviewFinding } from './types.ts'

const SEVERITY_RANK: Record<string, number> = {
  blocker: 0,
  high: 1,
  medium: 2,
  low: 3,
}

// Conservative title-token clustering: prefer keeping distinct findings over silently merging them.
const SIMILARITY_THRESHOLD = 0.5
const MIN_TOKEN_OVERLAP = 2

// For the near-line pass we tighten the bar: titles need to be more clearly the
// same defect before we merge across different anchors, since lines that differ
// can plausibly be unrelated bugs in adjacent code.
const NEAR_LINE_SIMILARITY_THRESHOLD = 0.65
const NEAR_LINE_MIN_TOKEN_OVERLAP = 3
const NEAR_LINE_RADIUS = 3

const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'of',
  'on',
  'in',
  'to',
  'for',
  'with',
  'at',
  'by',
  'from',
  'into',
  'about',
  'as',
  'this',
  'that',
  'these',
  'those',
  'it',
  'its',
  'their',
  'there',
  'here',
  'and',
  'or',
  'but',
  'if',
  'then',
  'than',
  'so',
  'not',
  'no',
  'has',
  'have',
  'had',
  'do',
  'does',
  'did',
  'can',
  'could',
  'should',
  'would',
  'will',
  'may',
  'might',
  'when',
  'where',
  'what',
  'which',
  'who',
  'how',
  'why',
  'use',
  'used',
  'using',
  'make',
  'makes',
  'making',
])

export function tokenize(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
  return new Set(tokens)
}

export function diceCoefficient(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  if (a.size === 0 || b.size === 0) return 0
  let intersect = 0
  for (const t of a) if (b.has(t)) intersect++
  return (2 * intersect) / (a.size + b.size)
}

function intersectionSize(a: Set<string>, b: Set<string>): number {
  let n = 0
  for (const t of a) if (b.has(t)) n++
  return n
}

function clusterByTitleSimilarity(group: ReviewFinding[]): number[][] {
  const tokens = group.map((f) => tokenize(f.title))
  const clusters: number[][] = []
  const assigned = new Array<number>(group.length).fill(-1)

  for (let i = 0; i < group.length; i++) {
    if (assigned[i] !== -1) continue
    const tokensI = tokens[i]
    if (!tokensI) continue
    const idx = clusters.length
    const cluster = [i]
    assigned[i] = idx
    for (let j = i + 1; j < group.length; j++) {
      if (assigned[j] !== -1) continue
      const tokensJ = tokens[j]
      if (!tokensJ) continue
      if (
        diceCoefficient(tokensI, tokensJ) >= SIMILARITY_THRESHOLD &&
        intersectionSize(tokensI, tokensJ) >= MIN_TOKEN_OVERLAP
      ) {
        cluster.push(j)
        assigned[j] = idx
      }
    }
    clusters.push(cluster)
  }
  return clusters
}

function mergeCluster(group: ReviewFinding[], indices: number[]): ReviewFinding {
  const firstIdx = indices[0]
  if (firstIdx === undefined) throw new Error('mergeCluster called with empty indices')
  const firstFinding = group[firstIdx]
  if (!firstFinding) throw new Error('mergeCluster: invalid index into group')
  if (indices.length === 1) return firstFinding

  const sorted = [...indices].sort(
    (a, b) =>
      (SEVERITY_RANK[group[a]?.severity ?? ''] ?? 99) -
      (SEVERITY_RANK[group[b]?.severity ?? ''] ?? 99),
  )
  const primaryIdx = sorted[0]
  if (primaryIdx === undefined) throw new Error('mergeCluster: empty sorted indices')
  const primary = group[primaryIdx]
  if (!primary) throw new Error('mergeCluster: invalid primary index')
  const others = sorted.slice(1).flatMap((i) => {
    const f = group[i]
    return f ? [f] : []
  })

  const mergedFrom = others
    .filter((o) => o.domain !== primary.domain)
    .map((o) => ({ domain: (o.domain as string) ?? 'unknown', title: o.title }))

  return {
    ...primary,
    suggestion: primary.suggestion ?? others.find((o) => o.suggestion !== undefined)?.suggestion,
    description:
      primary.description +
      (mergedFrom.length > 0
        ? `\n\n_Also flagged by: ${mergedFrom.map((m) => m.domain).join(', ')}_`
        : ''),
    mergedFrom: mergedFrom.length > 0 ? mergedFrom : undefined,
  }
}

function mergeNearLineDuplicates(findings: ReviewFinding[]): ReviewFinding[] {
  // Group by file. Within each file, walk findings sorted by severity then line,
  // and absorb any later finding whose line is within ±NEAR_LINE_RADIUS of an
  // existing kept finding's line and whose title is sufficiently similar.
  const byFile = new Map<string, ReviewFinding[]>()
  for (const f of findings) {
    const key = f.file || ''
    const list = byFile.get(key)
    if (list) list.push(f)
    else byFile.set(key, [f])
  }

  const result: ReviewFinding[] = []
  for (const group of byFile.values()) {
    const anchored = group.filter((f) => f.line != null)
    const unanchored = group.filter((f) => f.line == null)
    result.push(...unanchored)

    // Stronger severity wins when absorbing a near-line duplicate.
    const sorted = [...anchored].sort(
      (a, b) => (SEVERITY_RANK[a.severity] ?? 99) - (SEVERITY_RANK[b.severity] ?? 99),
    )

    type Kept = { finding: ReviewFinding; tokens: Set<string>; line: number }
    const kept: Kept[] = []

    for (const candidate of sorted) {
      if (candidate.line == null) continue
      const candidateLine = candidate.line
      const candidateTokens = tokenize(candidate.title)
      const absorber = kept.find((k) => {
        if (Math.abs(k.line - candidateLine) > NEAR_LINE_RADIUS) return false
        if (k.line === candidateLine) return false // exact anchor handled by primary pass
        const overlap = intersectionSize(k.tokens, candidateTokens)
        if (overlap < NEAR_LINE_MIN_TOKEN_OVERLAP) return false
        return diceCoefficient(k.tokens, candidateTokens) >= NEAR_LINE_SIMILARITY_THRESHOLD
      })

      if (!absorber) {
        kept.push({ finding: candidate, tokens: candidateTokens, line: candidateLine })
        continue
      }

      // Absorb candidate into the existing keeper, recording the merge.
      const mergedFromEntries = absorber.finding.mergedFrom ? [...absorber.finding.mergedFrom] : []
      if (candidate.domain && candidate.domain !== absorber.finding.domain) {
        mergedFromEntries.push({
          domain: candidate.domain as string,
          title: candidate.title,
        })
      }
      absorber.finding = {
        ...absorber.finding,
        suggestion: absorber.finding.suggestion ?? candidate.suggestion,
        mergedFrom: mergedFromEntries.length > 0 ? mergedFromEntries : absorber.finding.mergedFrom,
      }
    }

    result.push(...kept.map((k) => k.finding))
  }

  return result
}

export function deduplicateFindings(findings: ReviewFinding[]): ReviewFinding[] {
  const groups = new Map<string, ReviewFinding[]>()
  for (const f of findings) {
    const key = `${f.file}:${f.line ?? 'null'}`
    const list = groups.get(key)
    if (list) list.push(f)
    else groups.set(key, [f])
  }

  const exactPass: ReviewFinding[] = []
  for (const group of groups.values()) {
    const first = group[0]
    if (group.length === 1 && first) {
      exactPass.push(first)
      continue
    }
    const clusters = clusterByTitleSimilarity(group)
    for (const indices of clusters) {
      exactPass.push(mergeCluster(group, indices))
    }
  }

  return mergeNearLineDuplicates(exactPass)
}
