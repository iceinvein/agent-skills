import { expect, test } from 'bun:test'
import {
  formatFindingDescriptionMarkdown,
  parseFindingDescription,
} from '../finding-description.ts'

test('returns empty array for empty input', () => {
  expect(parseFindingDescription('')).toEqual([])
  expect(parseFindingDescription('   \n   ')).toEqual([])
})

test('parses canonical labelled paragraphs', () => {
  const input = [
    'Observation: The new resolver trusts a client-supplied userId.',
    '',
    'Why it matters: Any caller can list another tenant.',
    '',
    'Suggested direction: Read the user id from context.currentUser instead.',
  ].join('\n')

  const sections = parseFindingDescription(input)
  expect(sections.map((s) => s.kind)).toEqual(['observation', 'impact', 'suggestion'])
  expect(sections[0]?.label).toBe('Observation')
  expect(sections[1]?.label).toBe('Why it matters')
  expect(sections[2]?.label).toBe('Suggested direction')
  expect(sections[0]?.body).toBe('The new resolver trusts a client-supplied userId.')
})

test('accepts alternate label aliases', () => {
  const input = ['Context: foo.', '', 'Impact: bar.', '', 'Recommendation: baz.'].join('\n')
  const sections = parseFindingDescription(input)
  expect(sections.map((s) => s.kind)).toEqual(['observation', 'impact', 'suggestion'])
})

test('falls back to a single observation block when no labels match', () => {
  const sections = parseFindingDescription('The code does a thing and another thing.')
  expect(sections).toHaveLength(1)
  expect(sections[0]?.kind).toBe('observation')
  expect(sections[0]?.body).toBe('The code does a thing and another thing.')
})

test('detects "Needs verification" sections', () => {
  const input = [
    'Observation: looks risky.',
    '',
    'Needs verification: caller might guard it.',
  ].join('\n')
  const sections = parseFindingDescription(input)
  expect(sections.map((s) => s.kind)).toEqual(['observation', 'verification'])
  expect(sections[1]?.label).toBe('Needs verification')
})

test('merges adjacent sections of the same kind', () => {
  const input = [
    'Observation: first sentence.',
    '',
    'Observation: second sentence.',
    '',
    'Why it matters: hurts users.',
  ].join('\n')
  const sections = parseFindingDescription(input)
  expect(sections).toHaveLength(2)
  expect(sections[0]?.body).toBe('first sentence. second sentence.')
})

test('keeps a real labelled block alongside a degenerate label-only block', () => {
  // An empty `Observation:` line is preserved; the second block still parses
  // as impact. This documents the current behaviour so future changes are
  // intentional.
  const sections = parseFindingDescription('Observation:\n\nWhy it matters: real impact.')
  expect(sections.map((s) => s.kind)).toEqual(['observation', 'impact'])
})

test('strips wrapping underscore emphasis', () => {
  const sections = parseFindingDescription('_Observation: italic block._')
  expect(sections).toHaveLength(1)
  expect(sections[0]?.body).toBe('italic block.')
})

test('formatFindingDescriptionMarkdown renders bold labels', () => {
  const md = formatFindingDescriptionMarkdown(
    'Observation: a.\n\nWhy it matters: b.\n\nSuggested direction: c.',
  )
  expect(md).toBe('**Observation:** a.\n\n**Why it matters:** b.\n\n**Suggested direction:** c.')
})

test('formatFindingDescriptionMarkdown collapses unlabelled prose to an observation', () => {
  const md = formatFindingDescriptionMarkdown('Just a single sentence with no labels.')
  expect(md).toBe('**Observation:** Just a single sentence with no labels.')
})
