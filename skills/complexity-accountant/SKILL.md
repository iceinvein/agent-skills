---
name: complexity-accountant
description: Use when the agent creates a new abstraction, splits code into multiple files, introduces a library or framework, or when code feels over-engineered. Trigger on "this is too complicated", "should I extract this?", "do we need this layer?", or when reviewing structural changes. NOT for initial scaffolding or established team patterns.
---

# Complexity Accountant

A structured complexity analysis framework based on John Ousterhout's *A Philosophy of Software Design*. Treats complexity as a finite budget — every abstraction, layer, and indirection must justify the complexity it adds by reducing complexity elsewhere. Modules should be deep (simple interface, rich functionality), not shallow (interface as complex as the implementation).

**Core principle:** Complexity is the root cause of most software difficulty. It manifests as change amplification, cognitive load, and unknown unknowns. The goal is not zero complexity — it's justified complexity where every cost buys a specific benefit.

## When to Use

- Creating a new abstraction (class, module, helper function, wrapper)
- Splitting code into multiple files or layers
- Introducing a library or framework to replace inline code
- "This is too complicated" / "Should I extract this?" / "Do we need this layer?"
- Reviewing structural changes or refactoring proposals

**Not for:** Initial project scaffolding with established frameworks, patterns the team has already committed to, trivial organizational changes (renaming, moving a constant).

## The Process

### 1. Measure Complexity Added

For every structural change, evaluate impact across Ousterhout's three dimensions:

**Change amplification** — How many places must change for a single logical change?
- Count: if you add a field to a data type, how many files need updating?
- If the answer is > 2, the structure is amplifying changes. Name the specific coupling that causes this.

**Cognitive load** — How much must a developer hold in their head to work here?
- Count: modules involved, implicit ordering, non-obvious conventions, state to track
- A function that requires reading 3 other files to understand has high cognitive load
- Beware: more lines of code ≠ more cognitive load. A single clear 50-line function often has less cognitive load than five 10-line functions spread across files.

**Unknown unknowns** — Things a developer needs to know that aren't apparent from reading the code.
- Hidden dependencies ("this only works if X runs first")
- Implicit initialization order
- Convention-based behavior ("files named *.handler.ts are auto-registered")
- Side effects that aren't visible in the function signature

### 2. Depth Test

For every new module, function, or class, evaluate its depth:

**Deep module** = Simple interface, lots of functionality behind it. The caller's life is genuinely easier because the module absorbs complexity.
- Good example: `fs.readFile(path)` — one call hides file descriptors, buffering, encoding, OS syscalls
- Good example: `db.query(sql, params)` — one call hides connection pooling, parameterization, result mapping

**Shallow module** = Interface nearly as complex as its implementation. The abstraction doesn't earn its keep.
- Bad example: `UserValidator` class that wraps three `if` statements
- Bad example: `ConfigManager` that just reads `process.env` with a method per variable
- Bad example: `ApiClient` where every method is a one-liner calling `fetch` with different URLs

**The inlining test:** Would removing this abstraction and inlining the code make things simpler or more complex? If simpler — the abstraction is shallow. Kill it.

### 3. Justify or Kill

If a new abstraction doesn't meaningfully reduce at least one complexity dimension, remove it.

**Justifications that DO count:**
- "This absorbs the complexity of [specific thing] so callers don't need to know about it"
- "Without this boundary, changing [X] would require modifying [N] files instead of 1"
- "This eliminates an unknown-unknown: callers no longer need to know about [hidden constraint]"

**Justifications that do NOT count:**
- "Might be useful later" — YAGNI. Add it when it's needed, not when it's imagined.
- "Separation of concerns" — without naming the specific concerns being separated and why they need separation.
- "It's the standard pattern" — patterns serve purposes. Name the purpose in this codebase. If the purpose doesn't apply, the pattern doesn't apply.
- "Makes it more testable" — only valid if you're actually writing those tests right now. Hypothetical testability is not a benefit.
- "Clean architecture says so" — architecture serves the system, not the reverse.

### 4. Complexity Budget Report

Produce a brief annotation with every non-trivial structural change:

```
COMPLEXITY: [what changed]
  Added: [specific complexity cost]
  Bought: [specific benefit — what's easier now?]
  Net:    [worth it / not worth it / marginal — with reasoning]
```

Example:

```
COMPLEXITY: Extract PricingEngine from OrderProcessor
  Added: new module boundary (+1 file to understand), interface between them (PricingInput/PricingResult types)
  Bought: pricing rules can change without touching order flow, pricing is independently testable with known inputs
  Net:    worth it — pricing is a likely change axis and the boundary matches a real domain separation
```

Counter-example:

```
COMPLEXITY: Extract validateEmail into utils/validation.ts
  Added: new file, new import, function is now in a different directory from its only caller
  Bought: nothing — this function has one caller and the validation logic is 4 lines
  Net:    not worth it — inline it. If a second caller appears, extract then.
```

## Red Flags

| Signal | Diagnosis |
|--------|-----------|
| A wrapper that adds no logic, just delegates | Shallow module — remove the middleman |
| A file with one exported function under 10 lines | Doesn't need its own file — put it near its caller |
| An interface/type with only one implementation | Premature abstraction — inline it, extract when a second implementation appears |
| A "utils" or "helpers" directory | Complexity junk drawer — each utility should live near its caller |
| A class where most methods delegate to another class | Pass-through layer adding indirection without value |
| Configuration object with 15+ fields | Interface is as complex as the problem — the abstraction isn't simplifying anything |
| "Manager", "Handler", "Processor" suffix with vague responsibility | Name doesn't describe a clear, bounded responsibility |
| Three files created for one feature (type, implementation, barrel export) | Ceremony without benefit — does the feature need all three? |

## Guard Rails

**Don't punish good abstractions.** Deep modules that genuinely simplify their callers' lives are worth their cost. The goal isn't minimal code — it's minimal accidental complexity.

**Respect existing architecture.** If the team uses a repository pattern and it's working, don't argue against it in the middle of a feature. The complexity accountant evaluates *new* additions, not relitigates committed decisions.

**Acknowledge uncertainty.** Sometimes it's genuinely unclear whether an abstraction earns its keep. Say so: "This is marginal — it could go either way. Here's what I'd watch for to decide later."

**Scale the analysis.** A 3-line helper doesn't need a complexity report. A new service layer does. Match the rigor to the stakes.

## The Ousterhout Heuristics (Reference)

1. **Classes should be deep, not shallow.** A deep class has a simple interface relative to the functionality it provides.
2. **Define errors out of existence.** Handle common error cases as part of the normal code path rather than throwing exceptions. An API that can't fail is simpler than one that handles 5 error types.
3. **Pull complexity downward.** It's better for a module to be internally complex with a simple interface than to push complexity onto its callers.
4. **General-purpose modules are deeper.** Making a module slightly more general often makes it significantly deeper — the same interface handles more cases.
5. **Different layer, different abstraction.** If two adjacent layers use the same abstraction, one layer is probably not adding value. Each layer should transform or enrich the abstraction.
6. **Complexity is incremental.** No single change makes a system complex — it's the accumulation of many "small" additions that each seemed harmless. This is why you account for every one.
