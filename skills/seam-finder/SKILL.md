---
name: seam-finder
description: Use when modifying existing code the agent didn't write, when the agent's instinct is to rewrite or heavily refactor, when adding tests to untested code, or when working in a codebase with minimal coverage. Trigger on "change this behavior", "add a feature to this", or any modification of legacy or unfamiliar code. NOT for greenfield code or code the agent just wrote in this session.
---

# Seam Finder

A structured approach to modifying existing code based on Michael Feathers' *Working Effectively with Legacy Code*. Before changing existing code, find the seams — places where behavior can be altered without editing the code at that point. Seams enable safe modification: you can sense what code does, separate dependencies, and change behavior through the narrowest possible incision.

**Core principle:** Existing code is not an obstacle to be rewritten. It's a system with embedded knowledge — implicit behavior, battle-tested edge case handling, and hard-won correctness. The default is *preserve*, not *replace*. Find the seam, make the minimal incision.

## When to Use

- Modifying existing code you didn't write (or wrote long ago)
- "Change this behavior" / "Add a feature to this existing code"
- When your first instinct is to rewrite or heavily refactor
- Adding tests to untested code
- Working in a codebase with minimal test coverage
- When a modification feels risky and you want a safe approach

**Not for:** Greenfield code, code you just wrote in this session, throwaway prototypes, or code the team has explicitly decided to rewrite.

## The Process

### 1. Identify the Seam Types

Before modifying existing code, survey the available seams:

**Object seam** — Can behavior be changed by passing a different object or dependency?
- Look for: constructor parameters, function arguments that accept interfaces, injected services, callback parameters, strategy patterns already in place
- This is the most common seam in object-oriented code. If a dependency is passed in, you can substitute it.

**Preprocessing seam** — Can the inputs be transformed before they reach this code?
- Look for: middleware chains, interceptors, data transformation layers, event handlers, input normalization steps
- The code doesn't change — its inputs do. This is safe because the original code path is untouched.

**Link seam** — Can a different implementation be substituted at the module or import level?
- Look for: imports that could be aliased, environment-based module resolution, plugin architectures, dependency injection containers, test mocks at the module level
- In dynamic languages, this is powerful. In static languages, it requires more planning.

If no seams exist, you may need to create one — but creating a seam is a smaller change than rewriting the code. Introduce one parameter, extract one function, add one interface.

### 2. Classify the Goal

What are you trying to do? The answer determines which seam to use.

**Sensing** — You need to observe what the code does.
- Goal: understand behavior, add tests, verify assumptions before changing anything
- Strategy: find a seam that lets you intercept outputs or side effects
- Example: pass a test double that records calls instead of making real network requests

**Separation** — You need to break a dependency so one side can change independently.
- Goal: modify one part without affecting another
- Strategy: find a seam that decouples the parts
- Example: extract a function parameter so the algorithm can be tested without its data source

### 3. Minimal Incision

Identify the **smallest change** that achieves the goal:

- NOT "refactor the function" — "extract this 4-line block behind a function parameter so we can vary its behavior"
- NOT "rewrite with better patterns" — "add one parameter that lets us substitute this dependency in tests"
- NOT "clean up while we're here" — "change only what we were asked to change"

**The one-sentence test:** Can you describe the change in one sentence? If it takes a paragraph, the incision is too large. Break it down.

### 4. Preserve the Unknown

Existing code has behavior you don't fully understand. Treat it with respect:

- **Assume load-bearing until proven otherwise.** That weird null check? Probably caught a production bug. That redundant-looking condition? Probably handles a case you haven't seen.
- **Side effects are features.** Logging, metrics, cache warming, audit trails — if you don't understand why a side effect exists, don't remove it.
- **Timing and ordering matter.** Reordering operations can break subtle invariants. If the original code does A before B, keep that order unless you can prove it doesn't matter.
- **Error swallowing may be intentional.** A catch-all that silently ignores errors looks wrong, but it might be preventing a cascade failure that took days to debug.

When in doubt: preserve, annotate with a question, and ask the human.

### 5. Present the Surgical Plan

Before making any changes, present the plan:

```
SEAM ANALYSIS: [what needs to change]
  Seam type:  [object / preprocessing / link / new seam needed]
  Location:   [file:line where behavior can be altered]
  Incision:   [the minimal change — one sentence]
  Preserved:  [what existing behavior is explicitly kept]
  Risk:       [what could break — be specific]
```

Example:

```
SEAM ANALYSIS: Add retry logic to payment processing
  Seam type:  object — PaymentProcessor accepts a gateway parameter
  Location:   src/payments/processor.ts:42 (constructor accepts PaymentGateway)
  Incision:   Wrap the existing gateway in a RetryingGateway decorator that retries on transient errors
  Preserved:  all existing payment logic, error handling, and logging untouched
  Risk:       retry could cause duplicate charges if the gateway doesn't support idempotency keys — verify before implementing
```

## Red Flags

| Agent impulse | Better approach |
|---------------|----------------|
| "Let me rewrite this function" | Find a seam. Make a minimal change. |
| "I'll refactor this to be cleaner" | Were you asked to refactor? If not — preserve and extend. |
| "This code is messy, let me fix it" | Messy code that works has value. Messy code that you break has negative value. |
| "I'll wrap this in a new abstraction" | Does the abstraction help the change, or does it just hide code you don't understand? |
| "Let me add types to make this safer" | Adding types to code you don't fully understand can introduce false confidence — the types might be wrong. |
| "I'll extract a class for this" | Is extraction the minimal incision, or are you redesigning while the patient is on the table? |
| "Let me clean up these comments/formatting" | Unrelated formatting changes make the diff noisy and hide the real change. Don't. |
| "This would be simpler if I just started over" | Simpler to write, maybe. Simpler to be correct? Almost never. |

## The Feathers Techniques (Reference)

1. **Sprout Method** — Need new behavior? Write a new function and call it from the existing code. Don't modify the existing logic — add alongside it.

2. **Wrap Method** — Need behavior before or after existing code? Rename the original, create a new function with the old name that calls the original plus the new behavior.

3. **Sprout Class** — Same as Sprout Method but at the class level. Create a new class for the new behavior and instantiate it from the existing code.

4. **Scratch Refactoring** — Need to understand code? Refactor it aggressively in a throwaway branch. Delete the branch. Now make your real, minimal change with the understanding you gained.

5. **Characterization Tests** — Before changing code, write tests that document its current behavior (even if that behavior seems wrong). These tests protect against accidental changes.

6. **The Legacy Code Dilemma** — To change code safely, you need tests. To add tests, you often need to change code. Seams break this cycle by creating safe points of intervention.

## Guard Rails

**Don't moralize about code quality.** The skill is about making safe, effective changes — not about judging the code you're working with.

**Small seams first.** If you need to create a seam, start with the smallest possible one. You can always widen it later.

**Characterize before changing.** If the code has no tests and you're about to modify it, write at least one characterization test first. Even a rough test that asserts current output is better than changing code with no safety net.

**Ask about the unknown.** When you encounter behavior you don't understand, ask the human before removing or modifying it. "I see this null check on line 47 — do you know if there's a case where this value is actually null in production?"
