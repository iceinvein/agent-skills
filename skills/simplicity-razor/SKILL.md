---
name: simplicity-razor
description: Use when the agent recommends a library, framework, or pattern, when proposing architecture or technology choices, when the user asks "should I use X?", or when code has many dependencies for its scope. Trigger on technology decisions and dependency introductions. NOT for choices the team has already committed to.
---

# Simplicity Razor

A decision framework based on Rich Hickey's *Simple Made Easy*. Distinguishes between "simple" (not interleaved — one concern per construct) and "easy" (near at hand — familiar, convenient). These are orthogonal properties. Easy things can be complex. Hard things can be simple. AI agents and developers consistently reach for easy over simple, accumulating *complecting* — the braiding together of independent concerns until the system becomes impossible to reason about.

**Core principle:** Before recommending any tool, library, pattern, or approach, name its strands. If they're braided together such that you can't change one without affecting the others, the solution is complex — regardless of how easy it is to use. Simplicity is a choice, not an accident.

## When to Use

- Recommending a library, framework, or pattern
- Proposing an architecture or technology choice
- "Should I use X?" where X is a popular tool or approach
- Code has many dependencies relative to its scope
- A solution feels "enterprise-grade" for a small problem
- Evaluating competing approaches

**Not for:** Choices the team has already committed to (don't relitigate the framework), trivial utility selections (date formatting library), or ecosystem-mandated tools (your CI provider's required CLI).

## The Process

### 1. Name the Strands

For any proposed solution, identify the independent concerns it handles:

- A function that does validation AND transformation AND logging: **3 strands**
- A library that couples data fetching with caching with state management: **3 strands**
- A pattern that ties request handling to serialization to error formatting: **3 strands**

Each strand should be nameable in 2-3 words. If you can't name the strands, you don't understand the solution well enough to recommend it.

**Naming exercise:** For a proposed ORM:
- Strand 1: query construction
- Strand 2: result mapping
- Strand 3: schema migration
- Strand 4: connection management
- Strand 5: query caching
- Strand 6: change tracking

That's 6 strands. Are they all braided? Can you use query construction without change tracking? If not, you've bought 6 concerns to solve 1 problem.

### 2. Complecting Test

Are any strands braided together such that you can't change one without affecting the others?

Ask for each pair:
- Can you change the validation logic without touching the transformation? **If no: complected.**
- Can you swap the data fetching strategy without reconfiguring the cache? **If no: complected.**
- Can you modify error formatting without changing request handling? **If no: complected.**

**The substitution test:** Can you replace one strand with a different implementation without modifying the code that handles the other strands? If you can, the strands are composed (good). If you can't, they're complected (investigate).

### 3. Easy vs. Simple Audit

For the proposed solution, evaluate both dimensions independently:

**Easy signals** (not inherently bad, but suspicious when used as justification):

| Signal | Why it's suspicious |
|--------|-------------------|
| "Everyone uses it" | Popularity ≠ simplicity. Popular tools are often complex tools with good marketing. |
| "It has a nice API" | Nice APIs can hide enormous complecting behind convenience methods. |
| "It's one line to add" | One line to add, but how many concepts to understand? |
| "It's the standard approach" | Standards emerge from momentum, not from analysis. |
| "There's a plugin for that" | Plugin ecosystems are dependency graphs you'll inherit. |
| "It handles everything" | "Everything" means braided concerns. What if you don't need everything? |

**Simple signals** (what to aim for):

| Signal | Why it's good |
|--------|-------------|
| "Each piece does one thing" | Single-strand constructs compose freely. |
| "I can replace this part without touching that part" | Strands are separated, not braided. |
| "The data flows in one direction" | Unidirectional flow is inherently less complected. |
| "There's no hidden state" | State that you can see is state you can reason about. |
| "I can understand this without reading my dependencies' source" | The abstraction boundary holds. |
| "I chose each piece deliberately" | Composition by choice, not by inheritance. |

### 4. Decomplect or Justify

If the solution complects, the agent must either:

**Decomplect** — Use separate, composable pieces:
- Replace the all-in-one library with focused tools that each handle one strand
- Split the multi-concern function into single-purpose functions that compose
- Use data-oriented designs that separate data from behavior

**Justify** — Explain *specifically* why the complecting is worth it:
- A measured performance requirement that the composed version can't meet
- The team has standardized on it and switching would be more disruptive than the complecting
- The braided concerns genuinely change together — not hypothetically, but *actually*, based on real change history

**Justifications that do NOT count:**
- "It's industry standard" — standards can be complex
- "Everyone uses it" — popularity is not simplicity
- "It's easier" — that is *literally the trap this skill exists to catch*
- "It's well-maintained" — maintenance quality doesn't affect complecting
- "It has good docs" — documented complexity is still complexity

### When the Human Requests Something Complex

Don't refuse. Present the analysis and ask:

> "Here's what [X] braids together: [strands]. Is that tradeoff worth it for your situation?"

The human may have context you don't — team familiarity, contractual obligations, performance constraints. Respect their decision. The skill ensures the decision is *informed*, not that it's *yours*.

## Output Format

```
SIMPLICITY: [proposed solution]
  Strands:      [list independent concerns involved]
  Complected:   [which strands are braided — or "none"]
  Easy score:   [high / medium / low]
  Simple score: [high / medium / low]
  Verdict:      [use it / decomplect / justify]
  Alternative:  [if complected — what's the simpler composition?]
```

Example:

```
SIMPLICITY: Using Redux + Redux Toolkit + RTK Query for app state
  Strands:      UI state, server cache, async data fetching, optimistic updates, devtools
  Complected:   server cache is braided with UI state (same store, same reducers)
  Easy score:   high (popular, well-documented, team knows it)
  Simple score: low (5 braided concerns behind one store abstraction)
  Verdict:      decomplect
  Alternative:  React state for UI + TanStack Query for server cache — each strand handled by a focused tool
```

## The Hickey Vocabulary (Reference)

| Term | Meaning | Example |
|------|---------|---------|
| **Simple** | Not interleaved; one braid | A pure function: data in, data out |
| **Easy** | Near at hand; familiar | An ORM with convention-over-configuration |
| **Complex** | Interleaved; multiple braids | A function that fetches, caches, transforms, and logs |
| **Complecting** | The act of braiding together | Adding "just one more concern" to an existing module |
| **Decomplecting** | The act of separating braids | Splitting a god module into composable parts |
| **Compose** | Combining simple things | Piping focused functions together |
| **Artifact** | What you build | Code, modules, services |
| **Construct** | Tools you use to build | Languages, libraries, patterns |

## Guard Rails

**Simple ≠ minimal.** A well-composed system of 10 focused tools can be simpler than a 3-tool system where each tool braids 5 concerns. Simplicity is about separation, not about having fewer things.

**Don't relitigate committed decisions.** If the team has chosen React, you don't run the simplicity razor on React. You run it on *new* choices being made within the React ecosystem.

**Acknowledge the tradeoff.** Sometimes easy IS the right choice — when time is the binding constraint, when the team's familiarity reduces the effective complexity, when the complecting is genuinely harmless for this project's expected lifetime. Say so when it's true.

**Composition has costs too.** Gluing together 8 tiny libraries has its own complexity — version management, interface adaptation, debugging across boundaries. The simplicity razor checks for braided concerns, not for an absolute count of dependencies.

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Treating "popular" as "proven simple" | Popularity signals ease, not simplicity. Evaluate strands. |
| Decomplecting into too many tiny pieces | Composition has costs. Find the right granularity. |
| Rejecting all libraries as "complex" | Libraries aren't inherently bad. Libraries that braid unrelated concerns are bad. |
| Running this analysis on every 3-line decision | Scale to stakes. A date formatting library doesn't need strand analysis. |
| Refusing the human's choice without explanation | Present the analysis. Respect the decision. You inform, you don't veto. |
