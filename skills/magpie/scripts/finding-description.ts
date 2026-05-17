export type FindingDescriptionSectionKind = 'observation' | 'impact' | 'suggestion' | 'verification'

export type FindingDescriptionSection = {
  kind: FindingDescriptionSectionKind
  label: string
  body: string
}

const LABEL_CONFIG: Array<{
  kind: FindingDescriptionSectionKind
  label: string
  patterns: RegExp[]
}> = [
  {
    kind: 'observation',
    label: 'Observation',
    patterns: [/^observation:/i, /^what it does:/i, /^what happens:/i, /^context:/i],
  },
  {
    kind: 'impact',
    label: 'Why it matters',
    patterns: [/^why it matters:/i, /^impact:/i, /^risk:/i, /^scale note:/i, /^why now:/i],
  },
  {
    kind: 'suggestion',
    label: 'Suggested direction',
    patterns: [/^suggest(?:ed)? direction:/i, /^suggestion:/i, /^consider:/i, /^recommendation:/i],
  },
  {
    kind: 'verification',
    label: 'Needs verification',
    patterns: [/^needs verification:/i, /^verify:/i, /^validation:/i, /^worth validating:/i],
  },
]

const SENTENCE_SPLIT_REGEX = /[^.!?]+(?:[.!?]+["')\]]*)?|[^.!?]+$/g

function cleanSegment(segment: string): string {
  const trimmed = segment.trim()
  if (!trimmed) return ''
  return trimmed.replace(/^_(.+)_$/s, '$1').trim()
}

function stripExplicitLabel(segment: string): FindingDescriptionSection | null {
  const cleaned = cleanSegment(segment)
  if (!cleaned || /^also flagged by:/i.test(cleaned)) return null

  for (const entry of LABEL_CONFIG) {
    for (const pattern of entry.patterns) {
      if (!pattern.test(cleaned)) continue
      const body = cleaned.replace(pattern, '').trim()
      if (!body) return null
      return { kind: entry.kind, label: entry.label, body }
    }
  }

  return null
}

function splitSentences(segment: string): string[] {
  const cleaned = cleanSegment(segment)
  if (!cleaned) return []
  return (cleaned.match(SENTENCE_SPLIT_REGEX) ?? [])
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

function classifySentence(sentence: string, hasSections: boolean): FindingDescriptionSectionKind {
  if (/^also flagged by:/i.test(sentence)) {
    return hasSections ? 'impact' : 'observation'
  }
  if (/needs verification|worth validating|verify with/i.test(sentence)) {
    return 'verification'
  }
  if (
    /^(consider|prefer|move|promot(?:e|ing)|store|add|introduce|materialize|index|extract|split)\b/i.test(
      sentence,
    )
  ) {
    return 'suggestion'
  }
  if (
    /^(because|this expression|this predicate|this query|this filter|that means|this is acceptable|fine at current volume|as history grows|as data grows|at realistic scale|it will degrade|this can|this causes|this scales)\b/i.test(
      sentence,
    )
  ) {
    return 'impact'
  }
  return hasSections ? 'impact' : 'observation'
}

function labelForKind(kind: FindingDescriptionSectionKind): string {
  return LABEL_CONFIG.find((entry) => entry.kind === kind)?.label ?? 'Observation'
}

function pushSection(
  sections: FindingDescriptionSection[],
  kind: FindingDescriptionSectionKind,
  body: string,
): void {
  const cleaned = cleanSegment(body)
  if (!cleaned || /^also flagged by:/i.test(cleaned)) return

  const previous = sections.at(-1)
  if (previous?.kind === kind) {
    previous.body = `${previous.body} ${cleaned}`.trim()
    return
  }

  sections.push({ kind, label: labelForKind(kind), body: cleaned })
}

export function parseFindingDescription(description: string): FindingDescriptionSection[] {
  const normalized = description.replace(/\r\n/g, '\n').trim()
  if (!normalized) return []

  const sections: FindingDescriptionSection[] = []
  const blocks = normalized
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)

  for (const block of blocks) {
    const explicit = stripExplicitLabel(block)
    if (explicit) {
      pushSection(sections, explicit.kind, explicit.body)
      continue
    }

    for (const sentence of splitSentences(block)) {
      const kind = classifySentence(sentence, sections.length > 0)
      pushSection(sections, kind, sentence)
    }
  }

  if (sections.length > 0) return sections

  const fallback = cleanSegment(normalized)
  return fallback ? [{ kind: 'observation', label: 'Observation', body: fallback }] : []
}

export function formatFindingDescriptionMarkdown(description: string): string {
  const sections = parseFindingDescription(description)
  return sections.map((section) => `**${section.label}:** ${section.body}`).join('\n\n')
}
