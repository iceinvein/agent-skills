import { expect, test } from 'bun:test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ReviewFinding } from '../../../scripts/types.ts'
import {
  assembleSpecialistPrompt,
  countOutsideCitations,
  EXCLUDED_FILES_BLOCK,
  numberProbeFindings,
  readImpactPart,
  renderBriefPart,
  RUN_HEADER_SHARDED,
  RUN_HEADER_UNSHARDED,
  BRIEF_CLOSING,
  sessionOutcome,
  transcriptReadPath,
} from '../probe-specialist.ts'

const FENCE = '```'

const SPECIALISTS_MD = `# Specialist prompts

Prose for the orchestrator.

## Output Contract

Write findings to <RUN_DIR>/findings/<focus>.json.

${FENCE}
{ "id": string }
${FENCE}

If you have no findings, write [].

## Focus blocks

### security

${FENCE}magpie-specialist-security
You are a security reviewer.

## What to look for

Injection.
${FENCE}

### bugs

${FENCE}magpie-specialist-bugs
You are a bug hunter.
${FENCE}
`

const IMPACT_PART = `
6. The impact map:

${FENCE}magpie-impact-part
## Outside the diff

<top entries>

<the path above> has the full list.
${FENCE}
`

const base = {
  specialistsMd: SPECIALISTS_MD,
  focus: 'security',
  runDir: '/runs/r1',
  worktree: '/runs/r1/worktree',
  target: 'PR #70',
  shard: null,
  brief: null,
  excludedFiles: false,
  impact: null,
}

const SECURITY_BLOCK = 'You are a security reviewer.\n\n## What to look for\n\nInjection.'
const CONTRACT =
  '## Output Contract\n\nWrite findings to /runs/r1/findings/<focus>.json.\n\n' +
  '```\n{ "id": string }\n```\n\nIf you have no findings, write [].'

test('an unsharded prompt is the focus block, the run header and the output contract', () => {
  expect(assembleSpecialistPrompt(base)).toBe(
    `${SECURITY_BLOCK}\n\n` +
      'You are reviewing PR #70.\nWorking directory: /runs/r1/worktree\nDiff: /runs/r1/diff.patch\n\n' +
      CONTRACT,
  )
})

test('a sharded prompt names the shard, its patch and the scope rule', () => {
  expect(assembleSpecialistPrompt({ ...base, shard: { n: 2, total: 5 } })).toBe(
    `${SECURITY_BLOCK}\n\n` +
      'You are reviewing PR #70.\nWorking directory: /runs/r1/worktree\nShard: 2 of 5\n' +
      'Diff: /runs/r1/shards/shard-2.patch\n\n' +
      'This shard is your review scope. The other shards belong to other agents working\n' +
      'in parallel: do not review files outside your shard, and do not report findings\n' +
      'anchored to them. Reading any file in the worktree for context is expected and\n' +
      'encouraged.\n\n' +
      CONTRACT,
  )
})

test('the excluded-files block and the brief follow the contract in that order', () => {
  const prompt = assembleSpecialistPrompt({
    ...base,
    excludedFiles: true,
    brief: '## What this PR is for\n\nLocks the namespace.',
  })
  expect(prompt).toBe(
    `${SECURITY_BLOCK}\n\n` +
      'You are reviewing PR #70.\nWorking directory: /runs/r1/worktree\nDiff: /runs/r1/diff.patch\n\n' +
      `${CONTRACT}\n\n` +
      'Files excluded by the path filter are absent from your diff but present in the\n' +
      'worktree, with their full patches in /runs/r1/diff.full.patch and the exclusion\n' +
      'list in /runs/r1/excluded-files.json. When a change in your scope implies a change\n' +
      'in an excluded file (a migration implies a model snapshot, a schema change implies\n' +
      'generated types), open it and cross-check rather than treating it as out of scope.\n\n' +
      '## What this PR is for\n\nLocks the namespace.',
  )
})

test('an impact prompt puts the outside-diff line under Diff and the impact part last', () => {
  const prompt = assembleSpecialistPrompt({
    ...base,
    specialistsMd: SPECIALISTS_MD + IMPACT_PART,
    shard: { n: 2, total: 5 },
    brief: '## What this PR is for\n\nLocks the namespace.',
    impact: {
      path: '/runs/r1/impact.shard-2.md',
      inline: '### Sibling routes\n- `/a` (diff: a.ts:3)',
    },
  })
  expect(prompt).toBe(
    `${SECURITY_BLOCK}\n\n` +
      'You are reviewing PR #70.\nWorking directory: /runs/r1/worktree\nShard: 2 of 5\n' +
      'Diff: /runs/r1/shards/shard-2.patch\nOutside the diff: /runs/r1/impact.shard-2.md\n\n' +
      'This shard is your review scope. The other shards belong to other agents working\n' +
      'in parallel: do not review files outside your shard, and do not report findings\n' +
      'anchored to them. Reading any file in the worktree for context is expected and\n' +
      'encouraged.\n\n' +
      `${CONTRACT}\n\n` +
      '## What this PR is for\n\nLocks the namespace.\n\n' +
      '## Outside the diff\n\n### Sibling routes\n- `/a` (diff: a.ts:3)\n\n' +
      '/runs/r1/impact.shard-2.md has the full list.',
  )
})

test('dollar patterns in the inline entries are pasted as written', () => {
  const prompt = assembleSpecialistPrompt({
    ...base,
    specialistsMd: SPECIALISTS_MD + IMPACT_PART,
    impact: { path: '/runs/r1/impact.md', inline: "  - a.ts:3 `s.replace(x, '$&$1')` `$'` `$$`" },
  })
  expect(prompt).toEndWith(
    "## Outside the diff\n\n  - a.ts:3 `s.replace(x, '$&$1')` `$'` `$$`\n\n" +
      '/runs/r1/impact.md has the full list.',
  )
})

test('dollar patterns in the impact path are pasted as written', () => {
  const prompt = assembleSpecialistPrompt({
    ...base,
    specialistsMd: SPECIALISTS_MD + IMPACT_PART,
    impact: { path: "/runs/$&$'/impact.md", inline: 'top' },
  })
  expect(prompt).toEndWith("top\n\n/runs/$&$'/impact.md has the full list.")
  expect(prompt).toContain("Diff: /runs/r1/diff.patch\nOutside the diff: /runs/$&$'/impact.md\n")
})

test('an unsharded impact prompt adds the outside-diff line as the header’s last line', () => {
  const prompt = assembleSpecialistPrompt({
    ...base,
    specialistsMd: SPECIALISTS_MD + IMPACT_PART,
    impact: { path: '/runs/r1/impact.md', inline: 'top' },
  })
  expect(prompt).toContain(
    'Diff: /runs/r1/diff.patch\nOutside the diff: /runs/r1/impact.md\n\n## Output Contract',
  )
})

test('an impact prompt without the impact part in specialists.md is refused, naming the block', () => {
  expect(() =>
    assembleSpecialistPrompt({ ...base, impact: { path: '/runs/r1/impact.md', inline: 'top' } }),
  ).toThrow('magpie-impact-part')
})

test('a focus with no block in specialists.md is refused, naming the focus', () => {
  expect(() => assembleSpecialistPrompt({ ...base, focus: 'performance' })).toThrow(
    'magpie-specialist-performance',
  )
})

test('the live specialists.md carries the run header, excluded-files and brief text verbatim', async () => {
  const live = await readFile(join(import.meta.dir, '../../../references/specialists.md'), 'utf8')
  for (const template of [
    RUN_HEADER_UNSHARDED,
    RUN_HEADER_SHARDED,
    EXCLUDED_FILES_BLOCK,
    BRIEF_CLOSING,
  ]) {
    expect(live).toContain(template)
  }
})

test('a full brief renders every heading in the part-5 order with the closing paragraph', () => {
  expect(
    renderBriefPart({
      purpose: 'Lock the UUID namespace.',
      changes: ['Adds a namespace constant', 'Verifies reports'],
      watchItems: ['Old reports'],
      unclear: ['Is the namespace public?'],
      reviewRules: [{ rule: 'No raw SQL', source: 'CONTRIBUTING.md' }],
    }),
  ).toBe(
    '## What this PR is for\n\nLock the UUID namespace.\n\n' +
      'What it does:\n- Adds a namespace constant\n- Verifies reports\n\n' +
      'Watch items:\n- Old reports\n\n' +
      'Open questions the scout could not resolve:\n- Is the namespace public?\n\n' +
      'Repository review rules:\n- No raw SQL (CONTRIBUTING.md)\n\n' +
      "This brief is the author's claim as understood by a reader who has not reviewed the\n" +
      'code. It is not ground truth. Where the diff contradicts it, that is a finding in\n' +
      'your domain, not a correction to the brief. A watch item is a pointer, not a verdict:\n' +
      'escalate it into a finding with your own risk fields, or leave it alone. A repository\n' +
      'review rule is a convention the maintainers wrote down: a change that breaks one is a\n' +
      "finding in your domain when the rule bears on it, citing the rule's source.",
  )
})

test('a brief with no watch items, open questions or rules omits those headings', () => {
  expect(
    renderBriefPart({
      purpose: 'Lock it.',
      changes: ['Adds a constant'],
      watchItems: [],
      unclear: [],
      reviewRules: [],
    }),
  ).toBe(
    '## What this PR is for\n\nLock it.\n\nWhat it does:\n- Adds a constant\n\n' +
      "This brief is the author's claim as understood by a reader who has not reviewed the\n" +
      'code. It is not ground truth. Where the diff contradicts it, that is a finding in\n' +
      'your domain, not a correction to the brief. A watch item is a pointer, not a verdict:\n' +
      'escalate it into a finding with your own risk fields, or leave it alone. A repository\n' +
      'review rule is a convention the maintainers wrote down: a change that breaks one is a\n' +
      "finding in your domain when the rule bears on it, citing the rule's source.",
  )
})

function assistantToolUse(name: string, input: Record<string, unknown>): string {
  return JSON.stringify({
    type: 'assistant',
    message: {
      content: [
        { type: 'text', text: 'looking' },
        { type: 'tool_use', name, input },
      ],
    },
  })
}

const STREAM_HEAD = '{"type":"system","subtype":"init"}\n'

test('a transcript that Reads the impact file counts as reading it', () => {
  const stream = `${STREAM_HEAD}${assistantToolUse('Read', { file_path: '/runs/r1/impact.md' })}\n`
  expect(transcriptReadPath(stream, '/runs/r1/impact.md')).toBe(true)
})

test('a transcript that only cats the impact file through Bash does not count', () => {
  const stream = `${STREAM_HEAD}${assistantToolUse('Bash', { command: 'cat /runs/r1/impact.md' })}\n`
  expect(transcriptReadPath(stream, '/runs/r1/impact.md')).toBe(false)
})

test('a transcript that Reads other files does not count as reading the impact file', () => {
  const stream =
    `${STREAM_HEAD}${assistantToolUse('Read', { file_path: '/runs/r1/impact.shard-2.md' })}\n` +
    `${assistantToolUse('Read', { file_path: '/runs/r1/diff.patch' })}\n`
  expect(transcriptReadPath(stream, '/runs/r1/impact.md')).toBe(false)
})

test('a transcript line that is not JSON is rejected with its line number', () => {
  expect(() => transcriptReadPath(`${STREAM_HEAD}not json\n`, '/x')).toThrow('line 2')
})

test('a successful session reports its cost and no error', () => {
  const stream = `${STREAM_HEAD}{"type":"result","subtype":"success","is_error":false,"total_cost_usd":1.25}\n`
  expect(sessionOutcome(stream, 0, '')).toEqual({ costUsd: 1.25, error: null })
})

test('a result event with no cost reports the cost as null', () => {
  expect(
    sessionOutcome(`${STREAM_HEAD}{"type":"result","subtype":"success","is_error":false}\n`, 0, ''),
  ).toEqual({ costUsd: null, error: null })
})

test('a session that ended in error keeps its cost and records the error', () => {
  const stream =
    `${STREAM_HEAD}{"type":"result","subtype":"error_max_budget_usd","is_error":true,` +
    '"total_cost_usd":3.02,"result":"budget spent"}\n'
  expect(sessionOutcome(stream, 1, 'boom')).toEqual({
    costUsd: 3.02,
    error: 'session ended in error (error_max_budget_usd): budget spent; exit 1: boom',
  })
})

test('a session with no result event records that instead of throwing', () => {
  expect(sessionOutcome(STREAM_HEAD, 0, '')).toEqual({
    costUsd: null,
    error: 'stream-json has no result event',
  })
})

test('a session whose transcript is not JSON records that instead of throwing', () => {
  expect(sessionOutcome('oops\n', 137, 'killed')).toEqual({
    costUsd: null,
    error: 'stream-json line 1 is not JSON: oops; exit 137: killed',
  })
})

function finding(id: string, file: string, description: string): ReviewFinding {
  return {
    id,
    file,
    line: 1,
    severity: 'medium',
    risk: { impact: 'medium', likelihood: 'possible', confidence: 'medium', action: 'should-fix' },
    title: 't',
    description,
    domain: 'security',
  }
}

const IMPACT_MD = [
  '### Other writers of the same data',
  '- `reports` (diff: src/api/lock.ts:10)',
  '  - src/db/writer.ts:44 `insert into reports`',
  '  - src/api/lock.ts:80 `update reports`',
].join('\n')

test('a finding citing a map location outside the shard counts as an outside citation', () => {
  const findings = [
    finding('a', 'src/api/lock.ts', 'Observation: src/db/writer.ts:44 also writes reports.'),
  ]
  expect(countOutsideCitations(findings, IMPACT_MD, ['src/api/lock.ts'])).toBe(1)
})

test('a map location inside the shard, or a location not in the map, is not an outside citation', () => {
  const findings = [
    finding('a', 'src/api/lock.ts', 'Observation: src/api/lock.ts:80 updates reports.'),
    finding('b', 'src/api/lock.ts', 'Observation: src/db/other.ts:12 reads reports.'),
    finding('c', 'src/api/lock.ts', 'Observation: src/db/writer.ts:45 is near the writer.'),
  ]
  expect(countOutsideCitations(findings, IMPACT_MD, ['src/api/lock.ts'])).toBe(0)
})

test('a finding citing several outside locations counts once', () => {
  const impact = `${IMPACT_MD}\n  - src/db/audit.ts:7 \`insert into reports\``
  const findings = [
    finding('a', 'src/api/lock.ts', 'See src/db/writer.ts:44 and src/db/audit.ts:7.'),
  ]
  expect(countOutsideCitations(findings, impact, ['src/api/lock.ts'])).toBe(1)
})

const RISK = { impact: 'high', likelihood: 'likely', confidence: 'high', action: 'must-fix' }

test('findings without an id are numbered by focus and shard from 1', () => {
  const findings = numberProbeFindings(
    [
      { file: 'a.ts', line: 1, risk: RISK, title: 'x', description: 'd' },
      { id: 'security-7', file: 'b.ts', line: 2, risk: RISK, title: 'y', description: 'd' },
      { file: 'c.ts', line: 3, risk: RISK, title: 'z', description: 'd' },
    ],
    'security',
    3,
    'findings/security.shard-3.json',
  )
  expect(findings.map((f) => f.id)).toEqual(['security-s3-1', 'security-7', 'security-s3-3'])
})

test('a findings file that is not an array is rejected, naming it', () => {
  expect(() => numberProbeFindings({}, 'security', 1, 'findings/security.json')).toThrow(
    'findings/security.json',
  )
})

async function runDirWith(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'magpie-probe-impact-'))
  for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text)
  return dir
}

test('a shard with no impact file is refused, naming the shard', async () => {
  const dir = await runDirWith({ 'impact.md': 'whole run\n', 'impact.brief.md': 'top\n' })
  await expect(readImpactPart(dir, { n: 2, total: 5 })).rejects.toThrow('shard 2')
})

test('a sharded run reads its shard’s impact file and brief', async () => {
  const dir = await runDirWith({
    'impact.shard-2.md': 'full\n',
    'impact.shard-2.brief.md': 'top entries\n',
  })
  expect(await readImpactPart(dir, { n: 2, total: 5 })).toEqual({
    path: join(dir, 'impact.shard-2.md'),
    inline: 'top entries',
  })
})

test('an unsharded run with no impact.md is refused', async () => {
  const dir = await runDirWith({})
  await expect(readImpactPart(dir, null)).rejects.toThrow('impact.md')
})

const LIVE_MD = join(import.meta.dir, '../../../references/specialists.md')

test('a base prompt from the live specialists.md carries the focus block and the whole contract', async () => {
  const prompt = assembleSpecialistPrompt({
    ...base,
    specialistsMd: await readFile(LIVE_MD, 'utf8'),
    focus: 'bugs',
  })
  expect(prompt).toStartWith(
    'You are a senior software engineer specialized in finding bugs through code review.\n',
  )
  expect(prompt).toContain(
    'If you have no findings, write []. Return as your final tool result a single line: ' +
      '`<focus>: <N> findings (<critical>/<high>/<medium>/<low> by risk.impact)`. ' +
      'Do not include other prose.',
  )
})

test('the live specialists.md names the part-5 headings renderBriefPart writes', async () => {
  const live = await readFile(LIVE_MD, 'utf8')
  for (const heading of [
    '## What this PR is for',
    'What it does:',
    'Watch items:',
    'Open questions the scout could not resolve:',
    'Repository review rules:',
  ]) {
    expect(live).toContain(`\n${heading}\n`)
  }
})
