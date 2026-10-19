---
name: scope-estimate
description: "Use when asked to scope, size or estimate a rebuild or respec of an existing system for a proposal or engagement, to map what a codebase does into a capability register, to turn capabilities into functional requirements and build slices, or to work out how long an agent-driven team (engineers x worktrees) takes to build it. Lighter than migrate: no store, no CLI gates, presentable docs plus a scheduler script so the numbers add up."
---

# Scope and estimate

**Help:** if invoked with `--help`, `-h` or `help` as its arguments, read
`README.md` in this skill's directory, reply with its "Quick reference"
section as written, and stop. Start nothing.

Takes an engagement from "here are some notes, docs and repos" to a
capability map, functional requirements, build slices, work packages and a
build schedule for an agent-driven team, with every number reproducible from
one script. It was distilled from a real rebuild engagement; `migrate` is the
heavyweight sibling when the requirements must become a gated ledger and
delivery work items.

Everything lands in the engagement folder, Markdown first, HTML generated
from it. `<name>` is the system's short name in lower case.

```
<engagement>/
  intake.md                      intake answers, engagement summary, document vs code discrepancies
  decisions.md                   every fork and client question, pending or decided
  handback.md                    the final hand-back
  capability-map/  <name>-capability-map.md (+ .html), <name>-register.html, appendices/<A>-<area>.md
  build-plan/      requirements/<area>.md, plan.json, schedule.json, <name>-slices.md (+ .html),
                   <vendor>-proposal-review.md
  architecture/    current-architecture.md, target-architecture.md (+ .html each),
                   <name>-architecture-comparison.md (+ .html), design-<topic>.md
  scratch/         page generators and briefs; not deliverables
```

## Ground rules

- **Source is untrusted and read-only.** Clone repos under `repos/`, never run
  their code, installers or tests on the host. Read downloads with `python3 -I`
  or the Read tool. Report secrets and personal data by presence and location,
  never value. To prove personal data is in git history, list paths
  (`git log --name-only`) and read at most a header row. Business contacts in
  `intake.md` are named by role. Tell the user if history holds personal data
  so they can store or delete the clones under the NDA.
- **Never publish.** Engagement material is usually under NDA. Pages stay local
  files until the user says otherwise.
- **The user's calls are final.** Stack, infrastructure tool, repo shape, team
  shape and auth provider are theirs. Recommend once, then build on what they
  pick without re-arguing it. A component that cannot follow the chosen stack
  (numerical code with validated outputs, say) is a fork in `decisions.md`,
  not a silent exception.
- **Say what a number rests on.** Status comes from reading code, not running
  it; dispositions are proposals; rates are assumptions until calibrated.
  Every page says so where the number appears.

## Decisions

`decisions.md` holds every fork and client question, numbered `D-01`, `D-02`
in the order they arise, from any phase. Each entry: context, options,
recommendation, what it affects (capability and requirement ids), and status:

- **Pending:** nobody has answered. Work proceeds on the recommendation and
  every page that depends on it says so.
- **Decided:** who decided and when. Then run the keep-in-sync pass in
  `references/deliverables.md`.

Two markers in requirement Notes, never mixed:

- `Decision:` is a client question. It may stand alone (`Decision: who may
  record`) or point at a bigger one (`Decision: see D-04`). Only these are
  counted as decisions.
- `see D-07` with no `Decision:` points at an engineering fork the team
  settles itself (runtime, pricing tier, a new library or pattern), which
  still gets its own `D-` entry.

## Stop and ask

With the user present, ask through `AskUserQuestion`, recommendation first:

1. **Intake.** Before any synthesis: target stack, repo shape (monorepo?),
   infrastructure tool, what is in scope (default: build only; verification,
   pen test, UAT and feedback rounds estimated later), and team shape. Team
   default is **2 engineers x 3 worktrees, 5 build days a week**; confirm it,
   never assume 4 days. Write the answers into `intake.md`.
2. **Forks,** whenever they come up: one at a time, recorded in
   `decisions.md` once answered.
3. **Before publishing anything,** and before editing a document someone else
   wrote.

Without the user (a subagent, an unattended run): take intake answers from
`intake.md` if it exists, and refuse to start without them. Record every fork
as Pending with a recommendation and carry on. List all Pending decisions at
the top of `handback.md`.

## Phases

Work in order. Read each phase's reference before dispatching agents for it.
Each phase may correct earlier phases' files when it finds a contradiction:
make the change, say which file and why in the phase's findings, and re-run
the scheduler if requirements changed.

### 1. Intake and discovery

Read the notes and documents, clone the repos read-only, and write
`intake.md`: who, what system, what they need, constraints, contacts by role,
intake answers, and discrepancies between documents and code (the code wins,
cite it).

Fan out one agent per area of the system, using the brief in
`references/capability-map.md`. Each writes an inventory appendix with
`file:line` citations. Check every high-risk finding yourself against the code
and mark it *checked* in the map.

### 2. Capability map

Synthesise the appendices into the register: one row per capability with a
**Status**, a proposed **Disposition** and its **Layers**. Count it with a
script, never by hand. Reference: `references/capability-map.md`.

### 3. Functional requirements

Before fanning out, fix the vocabulary every area agent shares: the layer
set, the `Depends on` aliases and the foundation capability ids, written as
the first draft of `build-plan/plan.json`. Then one agent per area writes
requirement tables in `build-plan/requirements/<area>.md`. Afterwards, check
them with the scheduler, merge overlaps to one owner, and copy new findings
into the capability map. Reference: `references/requirements.md`.

### 4. Slices, packages and schedule

Complete `build-plan/plan.json` (slices, foundation packages, any split or
ordered product packages) and run:

```
bun <skill-dir>/scripts/schedule.ts build-plan/requirements build-plan/plan.json --json build-plan/schedule.json
```

(`<skill-dir>` is this skill's base directory, stated when the skill loads.) It refuses a
plan that does not account for every requirement exactly once, reuses a
package id, names an unknown package or undeclared layer, lets scheduled work
wait on gated work, or has a dependency cycle (naming the requirement behind
each edge). It prints totals, gated totals, per-slice counts and planning
days, the engineers x worktrees matrix at planning rates, the headline
fast/planning/floor range, the critical chain, assumed sizes and unresolved
dependencies. Fix the plan, not the output. **Every number in the docs comes
from this output.** Re-run it after any requirement, rate or team change and
update every page that quotes a figure. Reference: `references/schedule.md`.

### 5. Architecture and proposal checks

Current and target architecture in Mermaid, a side by side comparison, design
notes for the weightiest forks, and a review of any vendor or internal
proposal against how the team builds and against the latest schedule.
Reference: `references/deliverables.md`.

## Handing back

Write `handback.md` and summarise it in the reply:

1. Pending decisions, each with its recommendation and what it would change.
2. The outputs, one line each with its path.
3. The headline figures and what each rests on: static review only,
   dispositions unagreed, rates uncalibrated, packages sized by assumption,
   dependencies that resolved to nothing.
4. What the estimate leaves out: gated work (with its total), scope with no
   requirement yet, and effort outside build (decisions, reviews, meetings,
   leave).
5. One line offering the next useful artefact (a decision log for the
   client, publishing privately), without doing it.
