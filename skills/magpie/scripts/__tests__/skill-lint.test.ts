import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'

const SKILL = new URL('../../SKILL.md', import.meta.url).pathname
const SKILL_JSON = new URL('../../skill.json', import.meta.url).pathname
const ref = (name: string) => new URL(`../../references/${name}`, import.meta.url).pathname
const FOCUSES = ['security', 'bugs', 'performance', 'code-smells', 'architecture'] as const

test('every references/ path SKILL.md cites exists on disk', async () => {
  const text = await readFile(SKILL, 'utf8')
  const cited = [...text.matchAll(/references\/[a-z0-9-]+\.md/g)].map((m) => m[0])
  expect(cited.length).toBeGreaterThan(0)
  for (const rel of new Set(cited)) {
    const body = await readFile(new URL(`../../${rel}`, import.meta.url).pathname, 'utf8')
    expect(body.length).toBeGreaterThan(0)
  }
})

test('references/ ships in the install bundle', async () => {
  // resolveBundlePaths silently drops include entries that match nothing, so a
  // missing entry here would install a SKILL.md whose prompts are all 404s.
  const manifest = JSON.parse(await readFile(SKILL_JSON, 'utf8')) as {
    bundle: { include: string[] }
  }
  const covers = (p: string) =>
    manifest.bundle.include.some((inc) => inc === p || p.startsWith(`${inc}/`))
  for (const name of ['specialists.md', 'critic.md', 'peer-review.md', 'scout.md']) {
    expect(covers(`references/${name}`)).toBe(true)
  }
})

test('references/specialists.md has a block for every focus', async () => {
  const text = await readFile(ref('specialists.md'), 'utf8')
  for (const focus of FOCUSES) {
    const tag = `magpie-specialist-${focus}`
    const fence = `\`\`\`${tag}`
    expect(text).toContain(fence)
    const start = text.indexOf(fence)
    const end = text.indexOf('```', start + tag.length + 3)
    const block = text.slice(start, end)
    expect(block).toContain('Output Contract')
    expect(block).toContain(focus)
  }
})

test('references/specialists.md carries the output contract next to the blocks', async () => {
  const text = await readFile(ref('specialists.md'), 'utf8')
  // The contract has to travel with the prompts: the orchestrator assembles
  // both into one subagent prompt from this single file.
  const contract = text.slice(0, text.indexOf('```magpie-specialist-'))
  expect(contract).toContain('## Output Contract')
  expect(contract).toMatch(/findings\/<focus>\.json/)
  expect(contract).toMatch(/Write findings to/i)
  // Severity, impact, likelihood, confidence, action enums must all be listed.
  expect(contract).toMatch(/"blocker".*"high".*"medium".*"low"/)
  expect(contract).toMatch(/"critical".*"high".*"medium".*"low"/)
  expect(contract).toMatch(/"likely".*"possible".*"edge-case".*"unknown"/)
  expect(contract).toMatch(/"must-fix".*"should-fix".*"consider".*"optional"/)
  expect(contract).toMatch(/"impact"[\s\S]*"likelihood"[\s\S]*"confidence"[\s\S]*"action"/)
  expect(contract).toMatch(/"body"[\s\S]*"startLine"[\s\S]*"endLine"/)
  // Anti-patterns flagged explicitly so subagents don't repeat the JSON-shape mistakes.
  expect(contract).toMatch(/NOT "lines"/)
  expect(contract).toMatch(/NOT "recommendation"/)
})

test('references/critic.md holds the rubric and both placeholders', async () => {
  const text = await readFile(ref('critic.md'), 'utf8')
  expect(text).toContain('```magpie-critic')
  expect(text).toContain('<<DEDUPED_FINDINGS_COMPACT>>')
  expect(text).toContain('<<DIFF_EXCERPT>>')
  expect(text).toContain('review-critic')
})

test('references/peer-review.md holds the prompt and the Claude preamble', async () => {
  const text = await readFile(ref('peer-review.md'), 'utf8')
  expect(text).toContain('```magpie-peer-review')
  expect(text).toContain('```magpie-peer-review-claude-preamble')
  expect(text).toContain('review-peer-review')
  for (const ph of ['<<PRIMARY_PROVIDER>>', '<<PEER_PROVIDER>>', '<<KEPT_FINDINGS_COMPACT>>']) {
    expect(text).toContain(ph)
  }
})

test('references/scout.md holds the scout prompt and the brief contract', async () => {
  const text = await readFile(ref('scout.md'), 'utf8')
  expect(text).toContain('```magpie-scout')
  expect(text).toContain('brief.json')
  for (const key of ['purpose', 'changes', 'subsystems', 'watchItems', 'unclear']) {
    expect(text).toContain(key)
  }
  for (const ph of ['<<RUN_DIR>>', '<<PR_NUMBER>>']) {
    expect(text).toContain(ph)
  }
  // The scout must never trigger a full index; that is a consent-gated GPU pass.
  expect(text).toMatch(/never call `approve_indexing`|do not call `approve_indexing`/i)
  // watchItems are context for specialists, not findings in their own right.
  expect(text).toMatch(/not a finding/i)
})

test('SKILL.md sends each stage to the reference file it needs', async () => {
  const text = await readFile(SKILL, 'utf8')
  const section = (heading: string) => {
    const start = text.indexOf(heading)
    expect(start).toBeGreaterThan(-1)
    const next = text.indexOf('\n### ', start + heading.length)
    return text.slice(start, next === -1 ? undefined : next)
  }
  expect(section('### 3. Context')).toContain('references/scout.md')
  expect(section('### 4. Specialists')).toContain('references/specialists.md')
  expect(section('### 6. Critic')).toContain('references/critic.md')
  expect(section('### 7. Peer review')).toContain('references/peer-review.md')
})

test('SKILL.md no longer inlines the prompt bodies it moved out', async () => {
  const text = await readFile(SKILL, 'utf8')
  for (const tag of ['magpie-specialist-', 'magpie-critic', 'magpie-peer-review', 'magpie-scout']) {
    expect(text).not.toContain(`\`\`\`${tag}`)
  }
  // The walkthrough is the always-read part; keep it small enough to be cheap.
  // Raised from 2600 when the sharded-dispatch and fallback-diff prose was added,
  // then from 3000 for the two code-intelligence interfaces: that's real,
  // load-bearing procedure, not bloat.
  expect(text.split(/\s+/).length).toBeLessThan(3250)
})

test('SKILL.md never instructs the agent to approve indexing', async () => {
  const text = await readFile(SKILL, 'utf8')
  // A full index is a consent-gated GPU pass. The context stage degrades instead.
  // Both interfaces expose the same footgun under different names, so both are named.
  expect(text).toContain('approve_indexing')
  expect(text).toMatch(/never call `approve_indexing`|do not call `approve_indexing`/i)
  expect(text).toMatch(
    /never run `code-intel index approve`|do not run `code-intel index approve`/i,
  )
})

test('SKILL.md stage 3 probes the code-intel CLI before the MCP tools', async () => {
  const text = await readFile(SKILL, 'utf8')
  const start = text.indexOf('### 3. Context')
  expect(start).toBeGreaterThan(-1)
  const section = text.slice(start, text.indexOf('\n### 4.', start))
  // Both interfaces drive the same daemon, but the CLI names the workspace on every
  // call, so it carries no session binding to leak past cleanup. Prefer it.
  expect(section).toContain('command -v code-intel')
  expect(section).toContain('mcp__code-intelligence__')
  expect(section.indexOf('code-intel')).toBeLessThan(section.indexOf('mcp__code-intelligence__'))
})

test('SKILL.md gives CODE_INTELLIGENCE a value per interface', async () => {
  const text = await readFile(SKILL, 'utf8')
  // The scout and specialist prompts branch on this, so all three values must be
  // spelled out where the probe assigns them.
  for (const value of [
    'CODE_INTELLIGENCE=cli',
    'CODE_INTELLIGENCE=mcp',
    'CODE_INTELLIGENCE=unavailable',
  ]) {
    expect(text).toContain(value)
  }
})

test('the rebind instruction is scoped to the MCP interface everywhere it appears', async () => {
  const text = await readFile(SKILL, 'utf8')
  // A CLI run holds no session binding, so an unconditional rebind sends the agent
  // after an MCP tool that is not in its tool list.
  const spans: ReadonlyArray<readonly [string, string]> = [
    ['### 4. Specialists', '\n### 5.'],
    ['### 10. Cleanup', '\n## '],
    ['## Aborting', ''],
  ]
  for (const [from, to] of spans) {
    const start = text.indexOf(from)
    expect(start).toBeGreaterThan(-1)
    const section = to ? text.slice(start, text.indexOf(to, start)) : text.slice(start)
    expect(section).toMatch(/CODE_INTELLIGENCE=mcp|MCP path/)
  }
})

test('SKILL.md logs codeIntelligence on both the done and skipped context outcomes', async () => {
  const text = await readFile(SKILL, 'utf8')
  const start = text.indexOf('### 3. Context')
  expect(start).toBeGreaterThan(-1)
  const section = text.slice(start, text.indexOf('\n### 4.', start))
  // The bind probe's result is known by the time either log line is written,
  // regardless of whether the scout produced a brief; specialists read this key
  // to decide whether to include the codebase-intelligence block.
  const doneEntry = section.match(/\{stage: context, status: done[^}]*\}/)
  const skippedEntry = section.match(/\{stage: context, status: skipped[^}]*\}/)
  expect(doneEntry?.[0]).toContain('codeIntelligence')
  expect(skippedEntry?.[0]).toContain('codeIntelligence')
})

test('SKILL.md rebinds the code-intelligence session at cleanup', async () => {
  const text = await readFile(SKILL, 'utf8')
  const start = text.indexOf('### 10. Cleanup')
  expect(start).toBeGreaterThan(-1)
  const section = text.slice(start, text.indexOf('\n## ', start))
  // Binding is per session with no per-call override, so a run that ends without
  // rebinding leaves the session pointed at a worktree that no longer exists.
  expect(section).toContain('bind_workspace')
})

test('SKILL.md rebinds before cleanup on the abort path too', async () => {
  const text = await readFile(SKILL, 'utf8')
  const start = text.indexOf('## Aborting')
  expect(start).toBeGreaterThan(-1)
  const section = text.slice(start)
  // Stage 3 bound the session to the worktree; `abort` deletes that worktree via
  // `magpie cleanup`, so it must rebind first or leave the session dangling.
  expect(section).toMatch(/rebind.*(\$REPO|stage 10)/i)
  expect(section).toContain('magpie cleanup')
})

test('SKILL.md rebinds before the stage-4 all-specialists-failed hard stop', async () => {
  const text = await readFile(SKILL, 'utf8')
  const start = text.indexOf('### 4. Specialists')
  expect(start).toBeGreaterThan(-1)
  const section = text.slice(start, text.indexOf('\n### 5.', start))
  // This path stops the run without calling cleanup, but a later resume or
  // abort must not find the session still pointed at the worktree.
  expect(section).toMatch(/rebind.*(\$REPO|stage 10)/i)
})

test('styles.css declares a prefers-color-scheme:dark block that overrides core tokens', async () => {
  const STYLES = new URL('../../templates/styles.css', import.meta.url).pathname
  const css = await readFile(STYLES, 'utf8')
  expect(css).toMatch(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{/)
  const darkBlockStart = css.search(/@media\s*\(prefers-color-scheme:\s*dark\)/)
  expect(darkBlockStart).toBeGreaterThan(-1)
  const darkBlock = css.slice(darkBlockStart)
  for (const token of ['--surface:', '--card:', '--ink:', '--line:', '--accent:']) {
    expect(darkBlock).toContain(token)
  }
  // Severity chips must be re-tuned for dark contrast, not left at the light values.
  expect(darkBlock).toContain('--sev-blocker-bg:')
  expect(darkBlock).toContain('--sev-medium-bg:')
  // Card shadow drops to none in dark.
  expect(darkBlock).toMatch(/--shadow-card:\s*none/)
})

test('rendered HTML opts into light/dark with a color-scheme meta tag', async () => {
  const { renderFindingsHtml } = await import('../render-findings.ts')
  const { renderProgressHtml } = await import('../render-progress.ts')
  const { getHighlighter } = await import('../highlight.ts')
  const highlighter = await getHighlighter()
  const findings = renderFindingsHtml({ findings: [], postStatus: {}, highlighter })
  const progress = renderProgressHtml({
    prNumber: 1,
    headSha: 'deadbeef0011',
    branch: 'main',
    stages: {
      setup: 'done',
      context: 'pending',
      specialists: 'pending',
      dedupe: 'pending',
      critic: 'pending',
      'peer-review': 'pending',
      report: 'pending',
      post: 'pending',
    },
    specialistCounts: {},
  })
  for (const html of [findings, progress]) {
    expect(html).toMatch(/<meta\s+name="color-scheme"\s+content="light dark"/)
  }
})

test('styles.css honors the HTML `hidden` attribute even on flex/grid elements', async () => {
  const STYLES = new URL('../../templates/styles.css', import.meta.url).pathname
  const css = await readFile(STYLES, 'utf8')
  // Specifically guards against the regression where .confirm-bar with
  // display: flex stayed visible despite a `hidden` attribute on the element.
  expect(css).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/)
})

test('severity chips and submit button no longer hardcode `color: white` (must flip with theme)', async () => {
  const STYLES = new URL('../../templates/styles.css', import.meta.url).pathname
  const css = await readFile(STYLES, 'utf8')
  // White text on saturated chips is fine in light, broken in dark; we now drive
  // chip ink from --sev-*-ink so it adapts. Don't allow `color: white` to creep back.
  for (const selector of [
    '.sev-blocker',
    '.sev-high',
    '.step.error',
    '.submit-btn',
    '.badge.failed',
  ]) {
    const start = css.indexOf(selector + ' {')
    if (start === -1) continue
    const end = css.indexOf('}', start)
    const block = css.slice(start, end)
    expect(block).not.toMatch(/color:\s*white\b/)
  }
})

test('SKILL.md checks for a resumable run before minting a new run id', async () => {
  const text = await readFile(SKILL, 'utf8')
  // §0 always computed a fresh `pr-<n>-<epoch>` id, so the resume section
  // (which keyed off that brand-new directory) could never fire.
  const setupSection = text.slice(0, text.indexOf('### 1. Setup'))
  expect(setupSection).toContain('magpie --list-runs')
  expect(setupSection).toMatch(/active/i)
})

test('SKILL.md does not gate resume on state/server-info', async () => {
  const text = await readFile(SKILL, 'utf8')
  const start = text.indexOf('## Resuming a crashed run')
  expect(start).toBeGreaterThan(-1)
  const section = text.slice(start, text.indexOf('## Aborting', start))
  // server-info is deleted when the server idles out, so a resumable run
  // fails that check. log.jsonl is the durable signal.
  expect(section).toContain('log.jsonl')
  expect(section).not.toMatch(/if .*server-info.* exists/i)
  // Resuming must restart the server; the old one is gone.
  expect(section).toContain('magpie serve')
  // `context` re-runs on resume too (bind probe plus a conditional scout
  // dispatch); the resume section must still call it out explicitly.
  expect(section).toContain('context')
})

test('SKILL.md names the report buttons that actually exist', async () => {
  const text = await readFile(SKILL, 'utf8')
  const actionBar = await readFile(
    new URL('../render-action-bar.ts', import.meta.url).pathname,
    'utf8',
  )
  for (const label of ['Post Selected', 'Post Recommended']) {
    expect(actionBar).toContain(label)
    expect(text).toContain(label)
  }
  // The old label was never rendered anywhere.
  expect(text).not.toContain('Post to PR')
})

test('SKILL.md has the stage walkthrough', async () => {
  const text = await readFile(SKILL, 'utf8')
  expect(text).toContain('## Stage walkthrough')
  expect(text).toMatch(/magpie setup/)
  expect(text).toMatch(/magpie serve/)
  expect(text).toMatch(/magpie dedupe/)
  expect(text).toMatch(/magpie render/)
  expect(text).toMatch(/magpie cleanup/)
})

const intelligenceBlock = (text: string, iface: 'cli' | 'mcp') => {
  const fence = `\`\`\`magpie-codebase-intelligence-${iface}`
  const start = text.indexOf(fence)
  expect(start).toBeGreaterThan(-1)
  return text.slice(start, text.indexOf('\n```', start + fence.length))
}

test('references/specialists.md carries a codebase-intelligence block per interface', async () => {
  const text = await readFile(ref('specialists.md'), 'utf8')
  for (const iface of ['cli', 'mcp'] as const) {
    const block = intelligenceBlock(text, iface)
    expect(block).toContain('indexing_in_progress')
    // The one operation a specialist must never perform, under either name.
    expect(block).toMatch(/never (call `approve_indexing`|run `code-intel index approve`)/i)
  }
})

test('the CLI intelligence block names the workspace per call instead of binding', async () => {
  const text = await readFile(ref('specialists.md'), 'utf8')
  const block = intelligenceBlock(text, 'cli')
  // The CLI has no bind_workspace: every invocation carries --repo, which is what
  // lets the five specialists query the same worktree in parallel without a
  // session binding they could clobber for each other.
  expect(block).not.toContain('bind_workspace')
  expect(block).toContain('--repo')
  expect(block).toContain('--json')
})

test('the MCP intelligence block still binds the workspace first', async () => {
  const text = await readFile(ref('specialists.md'), 'utf8')
  expect(intelligenceBlock(text, 'mcp')).toContain('bind_workspace')
})

test('every focus block names its intelligence capability on both interfaces', async () => {
  const text = await readFile(ref('specialists.md'), 'utf8')
  // A focus block reaches whichever interface the probe found, so naming only the
  // MCP tool leaves a CLI specialist with a verb it cannot invoke.
  const tools: Record<(typeof FOCUSES)[number], readonly [string, string]> = {
    security: ['trace_data_flow', 'investigate --mode data'],
    bugs: ['get_call_hierarchy', 'code-intel call-hierarchy'],
    performance: ['find_affected_code', 'investigate --mode impact'],
    'code-smells': ['search_code', 'code-intel search'],
    architecture: ['explore_dependency_graph', 'code-intel dependency-graph'],
  }
  for (const focus of FOCUSES) {
    const fence = `\`\`\`magpie-specialist-${focus}`
    const start = text.indexOf(fence)
    const block = text.slice(start, text.indexOf('```', start + fence.length))
    for (const tool of tools[focus]) expect(block).toContain(tool)
  }
})

test('references/scout.md documents both intelligence interfaces', async () => {
  const text = await readFile(ref('scout.md'), 'utf8')
  // The scout is dispatched with the same <<CODE_INTELLIGENCE>> value the
  // specialists get, so it has to know what `cli` and `mcp` each mean.
  expect(text).toContain('`cli`')
  expect(text).toContain('`mcp`')
  expect(text).toContain('code-intel ')
  expect(text).toContain('bind_workspace')
  expect(text).toMatch(/never (call `approve_indexing`|run `code-intel index approve`)/i)
})

test('the output contract tells specialists to look before they hedge', async () => {
  const text = await readFile(ref('specialists.md'), 'utf8')
  const contract = text.slice(0, text.indexOf('```magpie-specialist-'))
  expect(contract).toContain('Needs verification:')
  expect(contract).toMatch(/look before .*hedg/i)
})

test('the output contract documents both findings filenames', async () => {
  const text = await readFile(ref('specialists.md'), 'utf8')
  const contract = text.slice(0, text.indexOf('```magpie-specialist-'))
  // The pre-existing assertion must keep holding.
  expect(contract).toMatch(/findings\/<focus>\.json/)
  expect(contract).toMatch(/findings\/<focus>\.shard-<n>\.json/)
})

test('the run header documents the shard lines', async () => {
  const text = await readFile(ref('specialists.md'), 'utf8')
  expect(text).toContain('Shard: <n> of <N>')
  expect(text).toContain('shards/shard-<n>.patch')
})

test('specialists are told excluded files are still reachable', async () => {
  const text = await readFile(ref('specialists.md'), 'utf8')
  expect(text).toContain('diff.full.patch')
  expect(text).toContain('excluded-files.json')
})

test('stage 4 pins the shard field on the specialist log entry', async () => {
  const text = await readFile(SKILL, 'utf8')
  const start = text.indexOf('### 4. Specialists')
  expect(start).toBeGreaterThan(-1)
  const section = text.slice(start, text.indexOf('\n### 5.', start))
  // render-cmd sums per-focus findings counts keyed on this field. Drop it from a
  // sharded run and every shard of a focus lands in one 'all' bucket,
  // last-write-wins, so the progress page under-reports by up to the shard count
  // with no error anywhere. This prose is the only thing that produces the field.
  expect(section).toMatch(/\{stage: specialist,[^}]*\bshard: <n>/)
  // ... and the unsharded path must still omit it, or 'all' would never be used.
  expect(section).toMatch(/omit `shard`/i)
})

test('stage 4 reconciles the expected findings files before dedupe', async () => {
  const text = await readFile(SKILL, 'utf8')
  const start = text.indexOf('### 4. Specialists')
  const section = text.slice(start, text.indexOf('\n### 5.', start))
  // Stage 4 fails only when every specialist fails, so losing 1 of 30 agents
  // otherwise renders a report indistinguishable from a complete one.
  expect(section).toMatch(/findings\/<focus>\.shard-<n>\.json/)
  expect(section).toMatch(/5 × <shard count>/)
})

test('the stage-4 gate offers only options the pipeline can carry out', async () => {
  const text = await readFile(SKILL, 'utf8')
  const start = text.indexOf('**More than four shards')
  expect(start).toBeGreaterThan(-1)
  const gate = text.slice(start, text.indexOf('\n\n', start))
  // Option 2: --max-files is what binds on a PR of many small files, so naming
  // only --budget sends the user back to an unchanged shard count.
  expect(gate).toContain('--budget')
  expect(gate).toContain('--max-files')
  // Option 3 must name a mechanism that exists. There is no unreviewed marker in
  // the report, so the record is a diagnostic log entry, on a stage outside
  // status-cmd's ORDER ladder and never `status: error`.
  const { ORDER } = await import('../status-cmd.ts')
  const stage = gate.match(/\{stage: ([a-z-]+), status: ([a-z-]+)/)
  expect(stage?.[1]).toBeDefined()
  expect(ORDER as readonly string[]).not.toContain(stage?.[1])
  expect(stage?.[2]).not.toBe('error')
  expect(gate).toMatch(/skipped/)
})

test('the excluded-files note is part of the specialist prompt, not commentary', async () => {
  const spec = await readFile(ref('specialists.md'), 'utf8')
  // Every other specialist-directed line lives in a fenced block; this one used to
  // sit unfenced between two numbered assembly parts, where an assembling agent
  // reads it as a note to itself and the specialist never sees it.
  const fences = [...spec.matchAll(/^```[a-z-]*\n([\s\S]*?)^```/gm)].map((m) => m[1] ?? '')
  const inFence = fences.some((body) => body.includes('diff.full.patch'))
  expect(inFence).toBe(true)
  // And it must be a numbered part of the assembly list, not floating text.
  expect(spec).toMatch(/^\d+\. The excluded-files block below/m)
})

test('the specialist assembly list is numbered contiguously from 1', async () => {
  const spec = await readFile(ref('specialists.md'), 'utf8')
  // Anchor on the heading, not on item 3's inline `## Output Contract` reference.
  const preamble = spec.slice(0, spec.indexOf('\n## Output Contract'))
  const numbers = [...preamble.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]))
  expect(numbers.length).toBeGreaterThan(4)
  expect(numbers).toEqual(numbers.map((_, i) => i + 1))
})

test('SKILL.md documents the shard manifest and the fan-out gate', async () => {
  const text = await readFile(SKILL, 'utf8')
  expect(text).toContain('shards/manifest.json')
  expect(text).toContain('diff.patch')
  // The confirmation gate above four shards is the design's only interactive stop.
  expect(text).toMatch(/more than four shards/i)
})
