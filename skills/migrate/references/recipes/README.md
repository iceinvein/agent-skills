# Recipe contract

A recipe answers one question for one source stack: what are at least two
independent directions for enumerating each declared surface, and what probe
realises each one. That is the whole contract.

> A recipe supplies, per surface type in `[surfaces].types`, at least two
> independent directions and the probes that realise them. Nothing else.

The lens contract itself, what a direction is, how directions get deduped
and diffed against the ledger, how a census record closes a surface, is
stated once in `references/phases/enumerate.md` and is not repeated here. A
recipe is an input to that contract, not a second copy of it.

## What a recipe does not do

- **It does not restate the lens contract.** No prose here should explain
  what enumerating from two directions means, what `evidence` is for, or how
  a census record balances. That is `enumerate.md`'s job.
- **It does not carry classification rules.** Deciding **add**, **skip with
  a named reason**, or **queue** for something a probe turns up is the
  enumerating agent's judgment call against this specific source, not
  something a recipe file can decide in advance for every source in a stack
  family.
- **It does not gate anything.** A recipe cannot make `migrate check` pass or
  fail. The census does that, identically whether its directions came from a
  recipe or were derived by hand in contract-only mode.

## Selection

`[source].stack` is written once, in phase 0 (`references/phases/probe.md`),
from what `migrate init` detects in the source checkout. Enumerate reads it
back (`enumerate.md`'s Inputs section) to decide which file in this
directory, if any, names this run's directions.

The convention is one file per stack family, named `<family>.md`. A stack
value that names or clearly belongs to a family with a file here
(`aspnet-webforms`, `aspnet-mvc`, and `aspnet-webapi` all resolve to
`aspnet.md`) uses that file's directions. Nothing in the CLI performs this
lookup: it is a read the enumerating agent does for itself, the same way it
reads any other file `enumerate.md` names as an input.

**No file in this directory matches the detected stack.** That is
contract-only mode, described in `enumerate.md`'s "Contract-only mode"
section: the agent derives its own two directions per surface, and the
census gates them exactly as it would a recipe's. This is a supported path,
not a degraded one. An unmatched stack is evidence the source needs a
recipe eventually, not evidence the run cannot proceed today.

## Adding a stack

Adding support for a new stack is one new file in this directory, written to
the shape below, and no edit to any other file in this skill. `SKILL.md`,
the phase manuals, and the CLI do not name individual stacks anywhere; they
only read `[source].stack` and look in this directory. This is deliberate:
it is the property that keeps the recipe surface from becoming a second
place where classification rules or gating logic could leak in, and it is why
`aspnet.md` ships alongside this file rather than a longer list of
lightly-tested packs for stacks nobody has run a real migration against yet.

## File shape

One `#` title naming the stack. One `##` heading per surface, spelled
exactly as it appears in `[surfaces].types`. Under each heading, a bullet
list of at least two directions, each one line naming what the direction
reads and a `Probe:` line giving the literal command that reads it.

Below is `settings` and `workflows`, unmodified from `aspnet.md`, as the
shape to copy for a new stack: replace the direction names, descriptions,
and probes with the ones that actually apply, keep the two-line-per-direction
structure.

```markdown
## settings

- **Storage**: `appSettings` and `connectionStrings` entries in
  `web.config`.
  Probe: `rg -n -g '*.config' '<add (key|name)=' <source>`
- **Read sites**: `ConfigurationManager.AppSettings[...]` and
  `ConfigurationManager.ConnectionStrings[...]` reads in code, which can name
  a key `web.config` never declares (an environment-variable override, a key
  added only at deploy time).
  Probe: `rg -n -g '*.cs' 'ConfigurationManager\.(AppSettings|ConnectionStrings)' <source>`

## workflows

- **Multi-step controller flow (code)**: a wizard-shaped controller with
  sequentially named actions (`Step1`, `Step2`, ...).
  Probe: `rg -n -g '*.cs' 'ActionResult Step[0-9]+' <source>`
- **State carriers (code)**: `Session[...]` and `TempData[...]` reads and
  writes tying those steps together, independent of how the actions
  themselves happen to be named.
  Probe: `rg -n -g '*.cs' 'Session\[|TempData\[' <source>`
```

Every probe in `aspnet.md` was run against two throwaway ASP.NET-shaped
trees, built independently of each other, while writing it, so this excerpt
is proven content, not an invented template.

## Probes are a starting point

A probe here is a concrete command that worked against one real or
representative source. It is not a fixed script: a pattern that matches
nothing on a given checkout because that checkout names things differently
is not a broken probe, it is a signal to adapt the pattern. What actually
gates completeness is the surface's lens census in `enumerate.md`, run
against whatever the adapted probes turned up, not agreement with what is
written here.
