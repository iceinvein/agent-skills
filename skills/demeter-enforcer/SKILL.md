---
name: demeter-enforcer
description: Use when code chains method calls through intermediate objects, when a change to a deeply nested object breaks callers several layers away, when unit tests require constructing elaborate object graphs, or when functions take an object but immediately drill into its children. Trigger on "why does changing Address break OrderProcessor?" or when reviewing chain expressions. NOT for fluent APIs/builders that return this, stream/iterator pipelines, or internal navigation within a single aggregate.
---

# Demeter Enforcer

A structural analysis framework based on Karl Lieberherr's Law of Demeter (1987), developed at Northeastern University's Demeter Project. The Law of Demeter operationalizes coupling at the method call level—it catches the tight coupling that coupling-auditor identifies at module granularity but at individual method call granularity. The principle is elegantly simple: "Only talk to your immediate friends."

**Core principle:** An object should only call methods on its immediate friends—not on objects returned by those friends. Every hop through an intermediate object is a coupling point and a fragility risk.

## When to Use

- When code chains method calls through intermediate objects (a.getB().getC().doThing())
- When a change to a deeply nested object structure breaks callers several layers away
- When unit tests require constructing elaborate object graphs just to satisfy parameter dependencies
- When functions take a broad object type but immediately drill into nested fields
- When "returning this" for chaining creates invisible coupling
- "Why does changing Address break OrderProcessor?" / "Why does my test need to mock this whole object graph?"

**Not for:** Fluent APIs and builders that intentionally return `this` for method chaining (that's the pattern's point), stream/iterator pipelines where chaining is the abstraction, or internal navigation within a single aggregate or entity (if Address is part of Order, accessing order.address.street is fine—they're one cohesive unit).

## The Process

### 1. Identify Permitted Friends

For a method M on an object O, the only objects M is permitted to call methods on are:

1. O itself (this)
2. Parameters passed directly to M
3. Objects created within M
4. O's direct instance fields (this.field)
5. Global objects accessible to O (singletons, constants)

Any method call on an object *not* in this list is a violation.

Example:
```typescript
// In OrderProcessor.calculateShipping()
// Permitted:
this.calculateBase() // O itself
order.getAmount() // parameter passed to calculateShipping
const location = new Location() // created in method
this.config.getTaxRate() // O's direct field
GlobalRates.getDefault() // global

// NOT permitted:
order.getShippingAddress().getCountry() // this is a chain violation
function(request: HttpRequest) { 
  request.context.user.preferences.currency // drilling through intermediate objects
}
```

### 2. Detect Violations

There are three types of Demeter violations:

**Chain Violations** (a.b().c())
- Direct method chaining through returned objects
- Example: `order.getShippingAddress().getCountry().getName()`
- Risk: Every intermediate object becomes a hidden dependency; if Address.getCountry() changes type, the caller breaks

**Parameter Drilling**
- Function receives a broad object but immediately drills into nested fields
- Example: `function processOrder(request: HttpRequest) { const userId = request.context.session.user.id }`
- Risk: Function couples to the entire structure path; refactoring the request shape affects many callers

**Hidden Traversal**
- Wrapping the chain in a convenience method doesn't solve the problem
- Example: `order.getShippingCountry()` internally does `this.shippingAddress.country` — the violation is still there, just hidden
- Risk: The coupling is still present; it's just obscured. Tests still must construct the full graph.

### 3. Classify Each Violation

For each violation, assess severity:

- **Depth:** How many hops? (a.b() = 1 hop, a.b().c() = 2 hops). Higher depth = higher risk.
- **Knowledge Required:** What must a caller understand about intermediate types? The more a caller must know, the worse.
- **Fragility:** If the intermediate object changes its interface, how many callers break?
- **Frequency:** How often does the caller drill this path?

**Priority = Depth × Frequency**. A deep chain called once is lower priority than a shallow chain called 100 times.

### 4. Apply Fix Pattern

There are two primary fix strategies:

**Fix A: Tell, Don't Ask** (for behavior chains)
- If you're chaining method calls to *do something*, move the behavior to the object that owns the data.
- Instead of `order.getShippingAddress().calculateTax()`, ask the order to do it: `order.calculateShippingTax()`
- This pushes the responsibility to the data owner and eliminates the chain.
- Trade-off: OrderProcessor now depends on Order to provide the behavior; Order takes on a new responsibility.

**Fix B: Parameter Narrowing** (for data retrieval)
- If you're chaining method calls to *retrieve a value*, pass the specific value needed, not the container.
- Instead of `calculateShipping(order)` drilling into `order.getShippingAddress().getCountry()`, call `calculateShipping(order, shippingCountry)`.
- This breaks the chain and makes dependencies explicit.
- Trade-off: Callers must extract and pass the value; the function signature gets wider.

Choose based on context:
- Use Tell, Don't Ask when the chain corresponds to a real behavior or responsibility.
- Use Parameter Narrowing when you're just extracting data and the behavior is simple.

### 5. Demeter Report

For each violation analyzed:

```
DEMETER: [violating method/function]
  Chain:      [full expression]
  Depth:      [hops]
  Location:   [file:line]
  Fix:        [tell-don't-ask or parameter narrowing, with specific code]
  Trade-off:  [cost of fix]
```

Example:

```
DEMETER: OrderProcessor.calculateShipping()
  Chain:      order.getShippingAddress().getCountry().getTaxRate()
  Depth:      3 hops
  Location:   src/orders/processor.ts:142
  Fix:        Tell, Don't Ask — call order.getShippingTaxRate() instead; move logic to Order class
  Trade-off:  Order class grows; OrderProcessor loses context of *why* it needs tax rate (name is important: getShippingTaxRate, not getCountryTaxRate)
```

```
DEMETER: InvoiceGenerator.buildHeader()
  Chain:      request.context.session.user.preferences.locale
  Depth:      4 hops
  Location:   src/invoices/generator.ts:67
  Fix:        Parameter narrowing — caller extracts locale and passes: buildHeader(request, locale: string)
  Trade-off:  buildHeader() signature gets wider; caller responsible for extracting value; more explicit
```

## Interaction Model

Decision engine. The agent analyzes method calls in code it writes or reviews, identifying chains and drilling patterns. It produces a Demeter report and applies fixes (tell-don't-ask for behavior chains, parameter narrowing for data retrieval). It prioritizes by depth × frequency—deep chains called often are fixed first. It doesn't obsess over single hops; the law is about reducing overall coupling, not eliminating every dot.

## The Law of Demeter Reference

Karl Lieberherr's formal statement of the Law of Demeter consists of five rules:

1. **Each unit should have only limited knowledge of other units:** Only units that are directly related to the current unit.
2. **Each unit should only talk to its friends:** Don't talk to strangers (objects you don't know directly).
3. **Only talk to your immediate friends:** If you need something from a friend's friend, ask your friend to get it for you.
4. **Don't climb the object tree:** Don't chain method calls to navigate through intermediate objects.
5. **The recipient of a message should not be the result of another message sent to a different object:** Avoid a.b().c(); instead, call a.getC() or ask a to do the work.

The Law was formalized as a graph constraint: from object O, you can only call methods on objects that are:
- O itself
- Formal parameters of the method
- Instance variables of O
- Locally created objects
- Global objects

## Guard Rails

**Don't count dots mechanically.** Some multi-dot expressions are fine. `LocalDate.of(2024, 4, 11).atTime(10, 30)` is a fluent API designed for chaining. The law is about reducing *coupling and fragility*, not eliminating all dots.

**Aggregates and entities are exceptions.** If Customer owns Address (they're a single aggregate), then `customer.address.street` is fine—it's internal navigation, not a violation. Demeter applies to module boundaries, not within cohesive entities.

**Don't wrap chains in facade methods.** Creating `order.getShippingCountry()` that internally chains `this.shippingAddress.country` doesn't solve the problem; it hides it. The fragility is still there.

**Balance pragmatism.** Some parameter drilling is acceptable in small codebases or in orchestration functions that *intentionally* understand the full structure. Apply the law where it reduces real fragility, not where it creates artificial parameters.

**Getters are often a Demeter smell.** If you're chaining getters (`obj.getA().getB().getC()`), that's almost always a violation. Getters exist to encapsulate data access—when you chain them, you've broken encapsulation.

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Wrapping chains in convenience methods | Creating a getter like `getShippingCountry()` that internally chains doesn't reduce coupling. Instead, apply Fix A (tell-don't-ask) or Fix B (parameter narrowing) to eliminate the chain altogether. |
| Applying Demeter to value objects you own | If Address is your aggregate's internal entity, `order.address.street` is fine. Demeter applies to module/object boundaries, not internal navigation. |
| Treating all multi-dot as violations | `List.of(...).stream().filter(...).map(...).collect()` is designed for chaining. Fluent APIs and pipelines intentionally use dots as an abstraction. Distinguish between intentional chaining (fluent APIs) and accidental chaining (coupling). |
| Creating God Object to avoid chains | If you extract every chain to the root object, you end up with a God Object that owns everything. Use Tell, Don't Ask *when there's a cohesive behavior*, not reflexively. |
| Ignoring Demeter in test code | Test code with elaborate object graph construction is a signal. If tests must build `new Request(new Context(new Session(new User(...))))` just to call a function, the function violates Demeter. |

## Cross-References

→ **coupling-auditor** — operates at module granularity; Demeter Enforcer operates at method call granularity. A module can have low coupling overall but still have Demeter violations within it.

→ **dependency-direction-auditor** — traces imports across layers; Demeter is about method-call dependencies *within* and *across* module boundaries. Together they catch coupling at different levels.

→ **cohesion-analyzer** — when Demeter violations are symptoms of low cohesion (a method is drilling through objects because it's trying to do too many things).
