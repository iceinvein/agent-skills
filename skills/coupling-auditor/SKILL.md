---
name: coupling-auditor
description: Use when reviewing how modules communicate, when one module change breaks others unexpectedly, when passing large objects between functions, or when shared state exists between modules. Trigger on "why did this break?", "these modules are too tangled", or when tracing unexpected side effects across boundaries. NOT for coupling within a single module's internals.
---

# Coupling Auditor

A structural analysis framework based on Constantine & Yourdon's *Structured Design*. Coupling measures the degree of interdependence between modules — it exists on a spectrum from loose (simple parameters) to tight (reaching into internals). Every coupling point has a type, a risk level, and a specific path to improvement. The goal isn't zero coupling — modules must communicate — but coupling should be as loose as the design allows.

**Core principle:** If changing module A requires understanding module B's internals, the coupling is too tight. Modules should communicate through the narrowest, simplest interface that gets the job done.

## When to Use

- Reviewing interactions between modules, classes, or services
- When a change in one module unexpectedly requires changes in another
- When large data structures are passed between functions
- When boolean flags control behavior across boundaries
- When modules share global or singleton state
- "Why did changing X break Y?" / "These modules are too tangled"

**Not for:** Coupling within a single module's internals (that's cohesion, a different concern), trivial function calls with simple parameters, or established framework patterns (don't audit how React components communicate with React — that's the framework's design).

## The Process

### 1. Identify Coupling Points

For each pair of communicating modules, find where and how they interact:
- Function/method calls across module boundaries
- Shared data structures passed between modules
- Shared global or singleton state
- Events or callbacks that cross boundaries
- Imports that pull in more than what's needed

Each interaction is a coupling point. Name it specifically: "OrderService calls PaymentGateway.charge() at order-service.ts:87."

### 2. Classify on the Spectrum

For each coupling point, classify its type from loosest to tightest:

**Data coupling** (loosest — aim for this)
- Modules communicate through simple, purpose-specific parameters
- Each parameter is necessary and independently meaningful
- Example: `getUser(userId: string)` — the caller passes exactly what's needed, nothing more
- Risk: Minimal. Changes to either module's internals don't affect the other.

**Stamp coupling**
- Modules share a composite data structure, but each uses only part of it
- Example: `getUser(request: HttpRequest)` when only `request.params.id` is needed
- Risk: Caller must construct/understand the full structure. Changes to the structure affect all users even if they only use a subset.
- Fix: Extract the specific fields needed into parameters.

**Control coupling**
- One module passes a flag or parameter that controls the other's internal logic flow
- Example: `getUser(id, { includeDeleted: true })` — the boolean changes the query logic inside
- Example: `processOrder(order, mode: 'test' | 'live')` — caller dictates internal behavior
- Risk: Caller must know callee's internal branching logic. The flag creates a hidden contract.
- Fix: Split into separate functions (`getUser` / `getUserIncludingDeleted`), or use strategy pattern.

**Common coupling**
- Modules share global or singleton state that both read and/or write
- Example: Both modules read/write `AppState.currentUser` or share a mutable cache
- Risk: Invisible dependencies. Changes to shared state by one module silently affect the other. Ordering and timing become critical.
- Fix: Pass shared state explicitly as a parameter, or use a mediator that owns the state.

**Content coupling** (tightest — always fix)
- One module directly accesses another's internal data, private fields, or implementation details
- Example: Module A reads Module B's private `_cache` property, or manipulates B's internal list directly
- Risk: Total dependency. Any change to B's implementation breaks A. This is the most fragile coupling type.
- Fix: Expose a proper interface. The internal data should never cross the boundary.

### 3. Recommend One Step Down

For each coupling point above data coupling, propose a **specific, minimal change** that moves it one level down the spectrum:

- Stamp → Data: "Replace the `Request` parameter with `userId: string` — that's the only field the function uses"
- Control → Data/Stamp: "Split `getUser(id, { includeDeleted })` into `getUser(id)` and `getDeletedUser(id)`"
- Common → Stamp/Data: "Pass `currentUser` as a parameter instead of reading from the global singleton"
- Content → Common/Data: "Add a `getCacheSize()` method to Module B instead of reading its private `_cache.length`"

The recommendation should be one step, not a full redesign. Move from content to common, or common to stamp — not from content straight to data.

### 4. Coupling Report

For each coupling point analyzed:

```
COUPLING: [module A] → [module B]
  Type:      [data / stamp / control / common / content]
  Point:     [file:line — the specific interaction]
  Risk:      [what breaks if module B's internals change]
  Fix:       [specific change to reduce coupling one level]
```

Example:

```
COUPLING: OrderService → PaymentGateway
  Type:      stamp — passes full Order object but gateway only uses amount and currency
  Point:     src/orders/service.ts:87 → gateway.charge(order)
  Risk:      adding/renaming Order fields could break gateway, gateway tests need full Order mocks
  Fix:       replace gateway.charge(order) with gateway.charge({ amount: order.total, currency: order.currency })
```

## Interaction Model

Decision engine. The agent analyzes coupling in code it writes or reviews, producing the coupling report alongside the diff. When reviewing existing code, it identifies the highest-risk coupling points (content and common coupling first) and recommends targeted fixes. The agent doesn't propose decoupling everything — it focuses on the tightest coupling that poses the most risk.

## Coupling vs. Cohesion

Coupling is about *between* modules. Cohesion is about *within* a module. They're related but distinct:

- **High coupling + high cohesion** = modules are individually well-organized but too dependent on each other. Fix the coupling.
- **Low coupling + low cohesion** = modules are independent but internally disorganized. Fix the cohesion.
- **Low coupling + high cohesion** = the goal. Modules are internally focused and externally independent.

This skill addresses coupling only. If a module has cohesion problems (doing too many unrelated things), that's a signal for the Module Secret Auditor skill.

## Guard Rails

**Don't decouple for its own sake.** Some coupling is inherent in the problem domain. Two modules that genuinely share a concept will have data coupling at minimum — that's fine.

**Focus on the tightest coupling first.** Content and common coupling are always worth fixing. Control coupling is usually worth fixing. Stamp coupling is worth fixing when it's causing real problems (unnecessary test complexity, change amplification). Data coupling is fine — leave it alone.

**Respect existing APIs.** If a function's signature is used by 50 callers, changing it has a high blast radius. The coupling may be real, but the fix must account for migration cost.

**Measure before prescribing.** Not all coupling is harmful. If two modules are tightly coupled but always change together and are owned by the same team, the coupling may be acceptable.

## The Constantine & Yourdon Principles (Reference)

1. **Minimize coupling between modules.** The less modules know about each other, the more independently they can evolve.
2. **Maximize cohesion within modules.** A module that does one thing well has fewer reasons to couple with others.
3. **Coupling type matters more than coupling count.** One content coupling is worse than five data couplings.
4. **Coupling is directional.** A depends on B ≠ B depends on A. Map the direction.
5. **The Law of Demeter operationalizes coupling.** "Don't talk to strangers" — a module should only call methods on its direct dependencies, not on objects returned by those dependencies.

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Treating all coupling as equally bad | Classify by type. Data coupling is fine. Content coupling must be fixed. |
| Decoupling by adding an abstraction layer | Adding a layer between coupled modules doesn't reduce coupling — it moves it. Reduce what's passed, not where it's passed. |
| Confusing coupling with dependency | Having a dependency isn't coupling. *How* you depend is coupling. Importing a module (link dependency) with a clean interface is fine. |
| Trying to achieve zero coupling | Modules must communicate. The goal is the *loosest* coupling that supports the communication needed. |
| Ignoring directional coupling | A → B and B → A is circular coupling, which is worse than either alone. Always map direction. |
