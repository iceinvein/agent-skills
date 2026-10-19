# scope-estimate

Scopes and estimates a rebuild or respec of an existing system for a proposal.
From notes, client documents and the legacy repos it produces a capability
map, functional requirements, build slices and work packages, a build
schedule for an agent-driven team (engineers x worktrees), architecture pages
and a review of any proposal, with every figure coming from one reproducible
scheduler run.

Use `migrate` instead when the requirements must become a gated ledger and
delivery work items for a migration already under way.

## Quick reference

```
/scope-estimate            start or resume a run in this folder
/scope-estimate --help     this quick reference
```

**Give it:** an engagement folder with `inputs/` (notes, client PDFs,
proposals) and `repos/` (clones; read only, never run).

**It stops for you at:** intake (stack, repo shape, infrastructure tool,
scope, team; default 2 engineers x 3 worktrees, 5 days a week), each
architecture fork, and before publishing or editing anyone else's document.

**Phases:** 1 discovery, 2 capability map, 3 requirements, 4 slices and
schedule, 5 architecture and proposal review, then `handback.md`.

**Outputs:** `intake.md`, `decisions.md`, `handback.md`, `capability-map/`,
`build-plan/` (requirements, `plan.json`, `schedule.json`, slices page),
`architecture/`.

**Come back when:** a decision lands ("we're going with Better Auth"), the
team changes, calibration rates are in, or a proposal quotes the estimate.
It updates the requirements, re-runs the scheduler and every page that quotes
a figure.

**Scheduler on its own:**
`bun <skill-dir>/scripts/schedule.ts build-plan/requirements build-plan/plan.json --json build-plan/schedule.json`
(`--help` lists the `plan.json` fields).

**Say when presenting:** status is from reading code, not running it; rates
are uncalibrated until the two-week calibration; requirement granularity
moves the estimate by about 20%, so quote the fast to floor range next to the
planning figure.

## Install

```
bunx @iceinvein/agent-skills install scope-estimate        # this project
bunx @iceinvein/agent-skills install scope-estimate -g     # every project
```

As a Claude Code plugin, after `/plugin marketplace add iceinvein/agent-skills`:

```
/plugin install scope-estimate@iceinvein-skills
```

Needs [Bun](https://bun.sh) for the scheduler. Claude Code only.

## Starting a run

Lay out the engagement folder:

```
<engagement>/
  inputs/    discovery notes, client documents, proposals
  repos/     the legacy repos, cloned read only
```

Then ask in plain words, for example "scope and estimate a rebuild of this
system from the notes, docs and repos", or invoke `/scope-estimate`. It also
triggers on "map the capabilities of this codebase", "turn the register into
requirements and slices" and "how long would 2 engineers take to build this".

## What happens

| Phase | What it does | What it asks you |
|---|---|---|
| 1. Intake and discovery | Writes `intake.md`; one read-only agent per area writes an inventory with `file:line` citations; high-risk findings are checked by hand | Target stack, repo shape, infrastructure tool, what is in scope (default build only), team shape |
| 2. Capability map | A register with Status, Disposition and Layers per capability, counted by script, plus risks, NFRs and open questions | Nothing; dispositions are proposals |
| 3. Requirements | Fixes the shared vocabulary in a draft `plan.json`, then one agent per area writes requirement tables; checks them with the scheduler, merges overlaps, writes findings back | Forks as they arise |
| 4. Slices and schedule | Completes `plan.json`, runs the scheduler, writes the slices document and its Gantt page | Forks as they arise |
| 5. Architecture and proposal | Current, target and side by side architecture in Mermaid, design notes, proposal review against the schedule | Consent before editing someone else's document |
| Handback | `handback.md`: pending decisions, outputs, what each figure rests on, what the estimate leaves out | The next step |

Every fork and client question goes into `decisions.md` as **Pending** with a
recommendation; work proceeds on the recommendation until you decide, and
then it becomes **Decided**.

Nothing is published. Engagement material is usually under NDA, so every page
stays a local file until you say otherwise.

## Outputs

```
<engagement>/
  intake.md          intake answers, engagement summary, document vs code discrepancies
  decisions.md       forks and client questions, Pending or Decided
  handback.md        the final hand-back
  capability-map/    <name>-capability-map.md (+ .html), <name>-register.html, appendices/
  build-plan/        requirements/<area>.md, plan.json, schedule.json,
                     <name>-slices.md (+ .html), <vendor>-proposal-review.md
  architecture/      current-architecture, target-architecture,
                     <name>-architecture-comparison (.md + .html), design-<topic>.md
  scratch/           page generators and agent briefs
```

## After the first run

- **A decision lands.** Tell it ("D-04: Better Auth"). It marks the entry
  Decided, updates the affected requirements, re-runs the scheduler and updates
  every page that quotes a figure.
- **The team changes.** Edit `team` in `build-plan/plan.json` or ask; the
  printed matrix already covers 2 to 4 engineers by 1 to 3 worktrees.
- **Calibration.** After the first two build weeks, put the measured days per
  S, M and L requirement into `rates` and re-run before committing to a date.
- **A proposal quotes the estimate.** Ask for a review; it checks figures and
  framing against `schedule.json`, and redlines a copy if the document is
  editable.

## The scheduler

```
bun <skill-dir>/scripts/schedule.ts <requirements-dir> <plan.json> [--json <out.json>]
```

`<skill-dir>` is the skill's install directory (e.g.
`.claude/skills/scope-estimate` for a bunx project install). It prints
totals, gated totals, per-slice requirements and planning days, the
engineers x worktrees matrix at planning rates, the headline fast, planning
and floor weeks, the longest dependency chain, packages sized by assumption
and dependencies that resolved to nothing. `--json` adds the full report,
including the lane order for every team combination.

It refuses a plan that misses or double-counts a requirement, reuses a
package id, names an unknown package or undeclared layer, has a dependency
cycle (naming the requirement behind each edge), or lets scheduled work
depend on gated work. Fix the plan, not the output.

### plan.json

Start from `templates/plan.example.json`.

| Field | What it holds |
|---|---|
| `daysPerWeek` | Build days per engineer-week, usually 5 |
| `rates` | Days per requirement by size, for `fast`, `plan` and `floor`, each `{ S, M, L }` |
| `team` | `engineers` and `worktrees` to tabulate, and the `headline` combination |
| `slices` | `{ id, name, goal, phase, capabilities, gated? }`. Gated slices hold client-decision work: counted, never scheduled |
| `foundations` | Hand-split foundation packages: `{ id, slice, name, members, after?, assumedDays? }`. `members` are requirement or capability ids; `assumedDays` sizes work with no requirement yet |
| `products` | Optional, same shape. Split a large capability, or give one product a real wait on another with `after`. Unlisted requirements become one package per capability |
| `dependsOn` | `foundation` and `product`: what every package of that kind waits on; `layers`: what a product waits on per layer it touches. Every layer used must be a key |
| `aliases` | Shorthand used in `Depends on` (`Auth`, `DB`) mapped to package ids; any case |

### Requirement tables

The scheduler reads tables whose header starts with `| FR |`:

```
### RC-01 Session setup (Carry)

| FR | Requirement | Actor | Layers | Size | Depends on | Source | Notes |
|---|---|---|---|---|---|---|---|
| RC-01.1 | The API shall return ... | System | api, db | M | Auth, RC-02.1 | A §1.1 | Decision: who may record |
```

Size is `S` (under half a day), `M` (about a day) or `L` (two to three days)
for an engineer working with agents. `Decision:` in Notes marks a client
question; `see D-07` points at an engineering fork. Write a literal pipe as
`\|`.

## Running it unattended

As a subagent or with nobody to answer, put the intake answers in
`intake.md` first; it refuses to start without them. Every fork is recorded as
Pending with a recommendation, work proceeds on it, and the open ones are
listed at the top of `handback.md`.
