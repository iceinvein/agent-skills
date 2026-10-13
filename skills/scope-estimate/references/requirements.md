# Functional requirements

## Fix the vocabulary first

Area agents run in parallel and reference each other, so before dispatching
write the first draft of `build-plan/plan.json` (from
`templates/plan.example.json`) with:

- **`dependsOn.layers`:** every layer key the requirements may use, each with
  an empty list for now. Use the register's layer set.
- **`aliases`:** the shorthand agents may write in `Depends on` (`Auth`, `DB`,
  `Contracts`, `Storage`, `Queue`), each mapped to the foundation capability
  that will own it. Narrow targets beat broad ones.
- **Foundation capability ids:** `FD-REPO`, `FD-CI`, `FD-CON`, `FD-API`,
  `FD-DB`, `FD-AUTH`, `FD-WEB`, `FD-INF`, `FD-SEC`, `FD-OBS`, plus one for any
  domain content package. List which register rows foundations own outright
  (platform infrastructure, auth plumbing) so no area restates them.

Put the same lists in the shared brief, `scratch/requirements-brief.md`.

## Agents

One agent per area: a **foundations** file plus one per product area of the
register. Brief each with the shared brief above, its register rows and
appendix, the non-functional requirements, `decisions.md`, the rules and the
table format below.

Disposition rules:

- **Carry:** today's behaviour, with exact values.
- **Fix:** the intended behaviour, naming the defect it corrects.
- **Redesign:** the new shape.
- **New:** built to the non-functional requirements.
- **Undecided, Optional:** written as if the answer were yes, self-contained so
  the whole capability can be gated in phase 4.
- **Drop:** no requirements; a short map of what replaces each job it did.

**Granularity drives the estimate,** so every agent cuts the same way: one
requirement is one behaviour that one test checks, at the level a reviewer
would accept or reject. Values, labels, defaults and copy that belong to one
behaviour go in that requirement (list them), not one row each; two
behaviours that fail independently are two rows. Aim for most capabilities
landing between 3 and 10 requirements. After the agents, compare each file's
share of S rows and its requirements per capability; a file well off the
others was cut differently, so re-brief it before moving on. Blind runs of the
same system with an unstated cut produced 537 and 984 requirements.

New forks found by parallel agents go in their file's findings as
`D-new: <question>`; the controller numbers them into `decisions.md` once all
agents finish. Register rows that foundations own keep their register ids as
capability headings in `foundations.md` (`### IA-01 ...`), so references to
them still resolve.

A value no source gives (a URL lifetime, a retry count) is written with
`placeholder` in Notes. A new library or pattern the requirement implies (a
charting library, a service worker) is an engineering fork: a `D-new` in the
file's findings and `see D-xx` in Notes, never `Decision:`. Work several areas need that nobody owns (a background
job runner) becomes a new foundation capability; tell the controller rather
than writing it three times.

## Format

One `###` heading per capability, then its table:

```
### RC-01 Session setup (Carry)

| FR | Requirement | Actor | Layers | Size | Depends on | Source | Notes |
|---|---|---|---|---|---|---|---|
| RC-01.1 | The API shall return ... | System | api, db | M | Auth, Contracts, DB | A §1.1 | Decision: who may record |
```

- **FR:** `<capability>.<n>`, unique across all files.
- **Requirement:** one observable "shall" statement a test could check.
- **Layers:** comma-separated from `dependsOn.layers`.
- **Size:** `S` under half a day, `M` about a day, `L` two to three days, for
  an engineer working with agents.
- **Depends on:** requirement ids, capability ids, a range
  (`FD-DB.2 to FD-DB.9`), or an alias. `-` for none.
- **Source:** appendix and section.
- **Notes:** `Decision:` (with the colon) marks a client question, and only
  that does; `Decision: see D-04` points at a bigger one. An engineering fork
  is `see D-07` without the marker (see `SKILL.md`, Decisions).

Parser rules: only tables whose header starts with `| FR |` are read, so other
tables can sit in the same file. Cells are separated by a space, a pipe and a
space (`| a | b |`, not `|a|b|`). A literal `|` inside a cell is written `\|`.
Every row has exactly eight cells.

## After the agents

1. **Check.** Run the scheduler against the draft plan: one slice per
   requirements file listing its capabilities, no `foundations`, empty
   `dependsOn` lists, and aliases pointing at capability ids (phase 4 remaps
   them to foundation packages). Every capability becomes one package and
   cross references become links, so it checks ids, sizes, row shape, layers
   and unresolved dependencies without any cycles. Fix every problem it names.
2. **Merge overlaps to one owner.** Where two files describe the same work,
   keep it in the owning file and trim the other to its difference. Totals
   then count each behaviour once.
3. **Write back.** Copy new findings and questions into the capability map
   (section 10 and open questions), new forks into `decisions.md`, and apply
   register corrections (status, disposition, layers, splits) directly,
   re-running the map's counting script.
