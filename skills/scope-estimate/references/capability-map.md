# Discovery and the capability map

## Choosing areas

One area per agent, each small enough to read in one sitting: usually one per
app or service, one for the backend and admin, one for each background
pipeline, and one for research or tooling repos that sit outside the service
but feed it (reference data builders, desktop tools). Tell each agent the
other areas exist and to stay in its lane; where two areas share an
interface (the worker API, say), both describe their side and the register
merges them.

## Discovery brief

Write one shared brief to `scratch/discovery-brief.md` and give it to every
agent with its area. It carries:

- The system in a paragraph, the target stack and repo shape from `intake.md`,
  and that the work is a rebuild, so notes should say what a rebuild must
  keep, fix or reshape.
- The repo paths for the area, read-only: nothing may be run, built or
  installed.
- Output: `capability-map/appendices/<letter>-<area>.md`.
- Every behaviour with a `file:line` citation, exact values (limits, timings,
  formats, copy shown to users) and quirks.
- Anything deduced rather than read marked *inferred*.
- Secrets and personal data reported by presence and location, never value;
  developer names and home paths copied from headers left out.
- Where code and documentation disagree.
- A closing list of candidate capabilities, and numbered defects and
  questions.

Good appendix sections: entry points and routes, data model, permission
matrix, user-visible flows step by step, integration contracts (payloads,
polling, queues), configuration and environment, operations, defects.

## Checking findings

A finding is **high-risk** when it touches personal or clinical data, credentials,
production data integrity, or the validity of a computed result. Read every
appendix, then check each high-risk claim against the code yourself and mark
it *checked* in the risk list. On a past engagement one "absent" claim turned
out to be "removed in a recent commit", which changes the row.

## Register

One table per domain. Columns:

| ID | Capability | Status | Disposition | Layers | Notes and source |
|---|---|---|---|---|---|

IDs are a two-letter domain prefix plus a number (`IA-01` identity and access,
`RC-07` recorder capture). Research tools outside the service boundary get
their own domain so they can be left out of the counts. **Layers** uses the
same set the requirements will (decide it here: for example `web, api, db,
worker, infra`); it feeds the by-layer table and phase 3.

**Status** (what is there today):

- **Live:** present, reachable from a page, route or the production worker's
  code path, and no defect found on reading the code. Static review only. A
  reachable debug tool is Live (and usually Drop).
- **Partial:** works with material gaps, including content the client must
  supply that is missing (images, reference data).
- **Broken:** reachable but fails.
- **Dead:** code exists but is unreachable.
- **Absent:** needed but not built.
- **Research:** not part of the service.

**Disposition** (proposed for the rebuild):

- **Carry:** rebuild with the same behaviour. When the layer is rewritten in a
  new stack, Carry means keep the behaviour, not the code; say so.
- **Fix:** rebuild with a named defect corrected.
- **Redesign:** needed, but what a user or another system sees changes (new
  flow, new contract, new ownership). Rewriting the code alone is not a
  redesign.
- **New:** required but not present today.
- **Drop:** not rebuilt.
- **Undecided:** waits on a client decision (`D-` entry in `decisions.md`).
- **Optional:** a nice-to-have the client may add.
- **Out of scope:** research rows and anything the intake excluded.

Undecided and Optional rows get requirements in phase 3 and become gated
slices in phase 4. A row that is part certain, part undecided is split into
two rows. Put this key on the register page itself; readers ask what the
dispositions mean.

## Document outline

1. Purpose, sources (with commit hashes), method (static, read-only), links to
   the appendices and `intake.md`.
2. **Summary in numbers:** status counts and shares, disposition counts and
   shares, the rows waiting on a decision by name, and a by-layer table for
   the target stack (what is rewritten vs what keeps its code, and how many
   capabilities each layer must build). Produce every figure with a counting
   script in `scratch/`, re-run after any register change.
3. **Reading these numbers:** they count capabilities, not effort;
   dispositions are proposals; status is from reading, not testing.
4. **How status was established** and **how to verify it**, in order of value
   (run existing tests in an isolated container and map them to IDs; a
   walkthrough with the domain lead; compare outputs against a reference
   implementation). Give the phrasing to use when presenting: "N of M
   present with no defect found on code review", never "N work".
5. The service on one page: flow diagram, actors and how each role is granted,
   scale today and target.
6. The register, by domain.
7. Domain content and reference data (word lists, scoring schema, catalogues).
8. Non-functional requirements (targets are proposals until agreed), and the
   target repository shape.
9. Capabilities the target needs that do not exist today.
10. Highest-risk findings, numbered, plus an empty "Findings from later
    phases" subsection for phases 3 to 5 to fill.
11. Open questions, numbered, each naming who has to answer.

## HTML pages

Generate pages from the Markdown with a small script in `scratch/` rather than
writing HTML by hand, so regenerating after an edit is one command. A
register-only page is often the one people share. Legends and keys must wrap,
not truncate. Embed any data the page needs; a page opened from disk cannot
fetch sibling files.
