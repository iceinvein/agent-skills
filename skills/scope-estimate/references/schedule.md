# Slices, packages and the schedule

## Slices

A slice is a feature one engineer owns end to end: schema, route with its
permission check, UI, tests and the infrastructure it needs. With generalist
engineers nobody is "the frontend person"; slices rotate. A scheduled slice
is 2 to 14 planning days, and its requirement tables are its spec card.

`phase` groups slices for reading; the scheduler ignores it. A package may sit
in a slice other than its capability's (a guard against copied files belongs
with CI), and counts toward the slice it sits in, but never across the gated
line: the scheduler refuses a scheduled package claiming gated work, or the
reverse. Contracts first means operations slices start as
soon as their foundations land, long before the product apps finish; say in
the document when they actually start, from the schedule.

- **0 Foundations:** monorepo and local dev stack, CI, contracts and API
  skeleton, data model, sign-in, web shell, domain content package, dev
  infrastructure and security baseline, logging.
- **1 Platform core:** tenancy and permissions, user management, account
  security, the core entities, consent or equivalent, storage, audit.
- **2 Product apps:** the user-facing apps and background workers.
- **3 Environments and operations:** promotion, monitoring, backup.

**Gated slices** hold every Undecided and Optional capability, one slice per
client decision, with `"gated": true`. They are counted and totalled, never
scheduled, and the size rule does not apply. A scheduled package may not wait
on a gated one; the scheduler refuses it.

Each slice gets a one-sentence goal stating what works when it is done. For
"depends on" per slice in the document, roll up package dependencies; two
slices can each have a package waiting on the other without a cycle.

## Work packages

- **Foundations** are split by hand into small packages in `foundations`,
  each a handful of related requirements (`F8f Auth configuration and VPC
  endpoints`). Work the sources forgot (often a local dev stack) gets
  `assumedDays` and is reported as an assumption. Scope that nobody has agreed
  is not given an assumed size; list it under what the estimate leaves out.
- **Products** need no listing: every requirement not claimed by a package
  becomes one package per capability. List a product package in `products`
  only to split a large capability (over about 5 planning days, or one that
  ends the critical chain) or to give it a real wait.
- **Contracts first.** A product package waits only on the foundation
  packages it uses: `dependsOn.product` for all, plus `dependsOn.layers` by
  the layers its requirements touch, plus any foundation its requirements
  name. A reference to another product is an **integration link**, checked
  when both sides land, never a blocker.
- **Real product waits** are for data, not contracts: a pipeline stage that
  needs the previous stage's output to build or test against. Give it
  `after` in `products`, and say in the document why a mock or fixture
  cannot stand in.
- **What a dependency means:** needed to build and test locally, not needed
  to deploy. `dependsOn.product` is what every product needs to run locally
  (the local dev stack, the API and web skeletons); deploy infrastructure is
  a dependency of the environment slices, not of every product.
- **Layers:** every layer used in a requirement must be a key in
  `dependsOn.layers`, even with an empty list.
- **Aliases** from the phase 3 draft point at capability ids; remap each to
  the foundation package that owns the work. Keys match regardless of case. Keep them narrow: if a
  requirement inside package A uses an alias that also names package B, and B
  depends on A, the two wait on each other. The scheduler refuses the cycle
  and names the requirement behind each edge.
- **Unresolved dependencies** are listed under "Dependencies that resolved to
  nothing". Fix the requirement or add an alias; each is a missing edge.

## Rates and team

`rates` are days per requirement by size. A starting point from a past
engagement:

| Rate | S | M | L | Meaning |
|---|---|---|---|---|
| fast | 0.1 | 0.4 | 1.0 | agents do most of it, little rework |
| plan | 0.25 | 0.75 | 2.0 | the planning case |
| floor | 0.5 | 1.0 | 2.5 | barely faster than without agents |

Lanes are engineers x worktrees, and each placed package in `schedule.json`
names its engineer and worktree. N worktrees per engineer holds only while
the engineer's own time on a package (spec, steering, review, checking in
dev) stays at or under about 1/N of its planning time; say so next to the
headline, and show the one-worktree column as the fallback.

The schedule is list scheduling: the lane that frees first takes the package
that can start now with the longest chain behind it. A credible order, not an
optimum. It does not keep one engineer's worktrees off the same files, and it
does not follow "finish your slice first", so real lanes will follow slices
more closely than the printed order; say both.

## Rules that go in the slices document

- Integration is continuous: whoever merges the second side of a link runs
  the flow end to end in dev that day.
- Contracts change through one PR that updates both sides.
- Pick up the oldest ready package in your slice before starting a new slice.
- One engineer's worktrees never touch the same migration or contract at once;
  pair packages from different slices or layers.
- Review is a second engineer, and reviews scale with worktrees.
- Parts agents cannot check (browser devices, sign-in on real devices, domain
  sign-off) carry more people time than their size suggests.

## Calibration

Nobody knows the team's real rate with agents until it is measured. Plan a
two-week calibration on the first foundation slices: record actual days per
S, M and L, and the engineer's own hours per package. At the end, put the
measured rates into `plan.json`, re-run, and commit to a date only then. Start
anything that waits on people in week 1: client decisions, domain sign-off of
the content package, account and landing-zone access.

## Slices document outline

1. Purpose, scope (build only unless agreed otherwise), sources.
2. Summary: totals, gated totals, the engineers x worktrees table at fast,
   planning and floor, the headline, the worktree condition.
3. How the requirements were produced, checks done and not done.
4. How slices work with generalist engineers.
5. Slice catalogue by phase: FRs (S/M/L), decisions, depends on, plan days.
6. Work packages: what "blocked by" means, real product waits and why, the
   effect on the critical chain, the rules above, the package catalogue.
7. Schedule: lane order for the headline team, things to start early,
   calibration.
8. Findings from the requirements work.
9. What this does not cover: verification, test cycles, pen test, UAT,
   gated slices (with their total), scope with no requirement yet, time away
   from building (spec cards, decisions, reviews, meetings), leave and
   ramp-up.

## HTML page

Engineers, worktrees and rate as selectors over the `schedules` array from
`schedule.json`, embedded in the page at build time (a page opened from disk
cannot fetch it). A Gantt per engineer and worktree whose scale ends at the
total (no empty tail); slices always visible as articles listing their
packages, with only the requirement tables collapsed; labels hidden on bars
too narrow to hold them.
