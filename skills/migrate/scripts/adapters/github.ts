import type { Adapter, HandoffInput } from '../handoff.ts'
import { buildWorkItems } from '../handoff.ts'
import type { ApplyResult, Completion, Requirement, Throughput, WorkItem } from '../types.ts'

// The marker is the whole identity mechanism for an issue. It sits in the
// body, so one `issue list` resolves every requirement in a single call, and
// it keeps working after handoff.json is lost or was never committed. That is
// why `refs` records only the milestone: with one issue per requirement, a
// stored ref per issue would be N lookups to learn what one list already says,
// and it would be the copy that goes stale.
const MARKER = /<!-- migrate:fr=([^\s>]+) -->/

type GhIssue = {
  number: number
  title: string
  body: string
  state: string
  closedAt: string | null
}
type GhMilestone = { number: number; title: string }

async function gh(input: HandoffInput, args: string[]): Promise<string> {
  const proc = Bun.spawn([input.ghBin, ...args], {
    cwd: input.root,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  await proc.exited
  if (proc.exitCode !== 0) {
    // The failure is reported with gh's own stderr rather than a paraphrase:
    // an auth prompt, a rate limit and a missing repo all arrive here and the
    // operator needs to tell them apart.
    throw new Error(`gh ${args[0]} ${args[1] ?? ''} failed: ${err.trim() || out.trim()}`)
  }
  return out
}

function issueTitle(req: Requirement): string {
  return `${req.id} ${req.requirement}`
}

function issueBody(req: Requirement, item: WorkItem): string {
  return [
    `<!-- migrate:fr=${req.id} -->`,
    '',
    `Capability: ${item.title} (${item.key})`,
    '',
    req.requirement,
    '',
    '| field | value |',
    '| --- | --- |',
    `| actors | ${req.actors} |`,
    `| objects | ${req.objects} |`,
    `| rules | ${req.rules} |`,
    `| confidence | ${req.confidence.kind} |`,
    `| origin | ${req.origin} |`,
    '',
    'Emitted by `migrate handoff --adapter github`. The marker above is how a',
    're-run finds this issue again; removing it will produce a duplicate.',
  ].join('\n')
}

async function listMilestones(input: HandoffInput, slug: string): Promise<GhMilestone[]> {
  const raw = await gh(input, ['api', `repos/${slug}/milestones?state=all`])
  return JSON.parse(raw) as GhMilestone[]
}

async function listIssues(input: HandoffInput): Promise<GhIssue[]> {
  const raw = await gh(input, [
    'issue',
    'list',
    '--state',
    'all',
    '--limit',
    '500',
    '--json',
    'number,title,body,state,closedAt',
  ])
  return JSON.parse(raw) as GhIssue[]
}

async function repoSlug(input: HandoffInput): Promise<string> {
  const raw = await gh(input, ['repo', 'view', '--json', 'nameWithOwner'])
  return (JSON.parse(raw) as { nameWithOwner: string }).nameWithOwner
}

function indexByMarker(issues: GhIssue[]): Map<string, GhIssue> {
  const byFr = new Map<string, GhIssue>()
  for (const issue of issues) {
    const m = MARKER.exec(issue.body ?? '')
    const fr = m?.[1]
    if (fr) byFr.set(fr, issue)
  }
  return byFr
}

export const github: Adapter = {
  name: 'github',

  async plan(input: HandoffInput): Promise<WorkItem[]> {
    return buildWorkItems(input.capabilities, input.requirements)
  },

  async apply(items: WorkItem[], input: HandoffInput): Promise<ApplyResult> {
    const slug = await repoSlug(input)
    const milestones = await listMilestones(input, slug)
    const byTitle = new Map(milestones.map((m) => [m.title, m]))
    const byFr = indexByMarker(await listIssues(input))
    const byId = new Map(input.requirements.map((r) => [r.id, r]))

    const created: string[] = []
    const updated: string[] = []
    const unchanged: string[] = []
    const refs: Record<string, string> = {}

    for (const item of items) {
      let milestoneCreated = false
      let milestone = byTitle.get(item.title)
      if (!milestone) {
        const raw = await gh(input, [
          'api',
          `repos/${slug}/milestones`,
          '-X',
          'POST',
          '-f',
          `title=${item.title}`,
          '-f',
          `description=${item.body.split('\n')[0] ?? ''}`,
        ])
        milestone = JSON.parse(raw) as GhMilestone
        byTitle.set(item.title, milestone)
        milestoneCreated = true
      }
      refs[item.key] = `milestone:${milestone.number}`

      let touched = false
      for (const fr of item.frs) {
        const req = byId.get(fr)
        if (!req) continue
        const body = issueBody(req, item)
        const existing = byFr.get(fr)
        if (!existing) {
          await gh(input, [
            'issue',
            'create',
            '--title',
            issueTitle(req),
            '--body',
            body,
            '--milestone',
            item.title,
          ])
          touched = true
          continue
        }
        if (existing.body !== body) {
          await gh(input, [
            'issue',
            'edit',
            String(existing.number),
            '--body',
            body,
            '--milestone',
            item.title,
          ])
          touched = true
        }
      }

      if (milestoneCreated) created.push(item.key)
      else if (touched) updated.push(item.key)
      else unchanged.push(item.key)
    }

    return { created, updated, unchanged, refs }
  },

  async throughput(input: HandoffInput): Promise<Throughput> {
    const issues = await listIssues(input)
    const known = new Set(input.requirements.map((r) => r.id))
    const completions: Completion[] = []
    for (const issue of issues) {
      if (issue.state.toUpperCase() !== 'CLOSED') continue
      const fr = MARKER.exec(issue.body ?? '')?.[1]
      // An issue with no marker was filed by someone else and says nothing
      // about this migration; one whose marker names a requirement the store
      // does not have is reported by coverage rather than silently counted.
      if (!fr || !known.has(fr)) continue
      completions.push({ fr, doneAt: issue.closedAt ? issue.closedAt.slice(0, 10) : null })
    }
    completions.sort((a, b) => a.fr.localeCompare(b.fr))
    return { completions, basis: 'github issues closed, dated from closedAt' }
  },
}
