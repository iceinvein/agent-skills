# Architecture & Design Patterns Reference

Decision-aid for the `codebase-architecture` skill. Concise per entry — enough to make a decision, not a textbook.

---

## Architectural Patterns (Macro)

### Layered (N-Tier)
Horizontal layers where each depends only on the layer below.
- **Use when:** Clear separation of concerns is needed; team members work on different layers; standard business applications.
- **Avoid when:** Heavy cross-cutting concerns; performance-critical paths that suffer from layer traversal.
- **Trade-off:** Simple to understand vs rigid boundaries that can lead to "pass-through" layers with no logic.

### Hexagonal (Ports & Adapters)
Core domain logic has no external dependencies. External systems connect through ports (interfaces) and adapters (implementations).
- **Use when:** Domain logic is complex and must be testable in isolation; multiple external integrations (DBs, APIs, queues).
- **Avoid when:** Simple CRUD apps where the indirection adds no value; small scripts or CLIs.
- **Trade-off:** Excellent testability and replaceability vs more files and indirection.

### Event-Driven
Components communicate through events. Producers don't know about consumers.
- **Use when:** Loose coupling between subsystems; async workflows; audit trails; multiple consumers for the same event.
- **Avoid when:** Simple request-response flows; you need synchronous consistency; small teams where the indirection isn't justified.
- **Trade-off:** Extreme decoupling vs harder debugging and eventual consistency challenges.

### CQRS (Command Query Responsibility Segregation)
Separate models for reading and writing data.
- **Use when:** Read and write patterns differ significantly; high-read/low-write or vice versa; complex domain with simple queries.
- **Avoid when:** Read and write models are nearly identical; adds complexity without benefit for simple domains.
- **Trade-off:** Optimized read/write paths vs maintaining two models and their synchronization.

### Pipe-and-Filter
Data flows through a sequence of processing steps, each transforming the input.
- **Use when:** Data transformation pipelines; compiler stages; ETL processes; middleware chains.
- **Avoid when:** Complex branching logic; interactive applications.
- **Trade-off:** Composable and reusable stages vs limited to sequential data flow.

### Microkernel (Plugin)
Minimal core with extensible functionality via plugins.
- **Use when:** Product must support customization; IDE-like extensibility; varying feature sets per deployment.
- **Avoid when:** All features are always needed; plugin overhead isn't justified.
- **Trade-off:** Maximum extensibility vs plugin API design is hard to get right and hard to change.

### Monolith-First
Single deployable unit. Extract services only when proven necessary.
- **Use when:** Starting a new project; small team; unclear domain boundaries; rapid prototyping.
- **Avoid when:** Domain boundaries are well-understood AND team scale demands independent deployment.
- **Trade-off:** Simple deployment and debugging vs harder to scale individual components independently.

---

## Design Patterns (Micro)

### Creating Things

**Factory** — Encapsulates object creation logic. Use when: construction is complex, multiple variants exist, or you want to decouple creation from usage.
- Detect: Functions named `createX()`, `buildX()`, or `XFactory` classes.
- Misuse: Factory for objects with trivial constructors (just use `new`).

**Builder** — Step-by-step construction of complex objects. Use when: objects have many optional parameters or construction requires validation.
- Detect: Method chaining patterns (`.setX().setY().build()`).
- Misuse: Builder for objects with 2-3 parameters (use constructor or options object).

**Singleton** — Single instance shared globally. Use when: truly global resources (DB connection pool, logger). **Use sparingly** — often a sign of hidden global state.
- Detect: `getInstance()`, module-level `export const instance = new X()`.
- Misuse: Using singleton when dependency injection would be cleaner and more testable.

### Structuring Relationships

**Adapter** — Translates one interface to another. Use when: integrating with external APIs or libraries whose interface doesn't match yours.
- Detect: Classes wrapping third-party libraries; `XAdapter`, `XWrapper` names.
- Misuse: Adapting internal code to internal code (just change the interface).

**Facade** — Simplified interface over a complex subsystem. Use when: callers need a simple API but the underlying system is complex.
- Detect: Classes that delegate to multiple subsystem objects; `XService`, `XManager` names.
- Misuse: Facade that just passes through to one class (unnecessary indirection).

**Decorator** — Wraps an object to add behavior without modifying it. Use when: cross-cutting concerns (logging, caching, auth); composable behavior layers.
- Detect: Classes/functions that wrap another and add behavior; middleware patterns.
- Misuse: Decorator chains so deep that debugging becomes impossible.

**Composite** — Tree structure where individual objects and compositions share the same interface. Use when: hierarchical data (file systems, UI component trees, org charts).
- Detect: Recursive structures where a node can contain children of the same type.

### Managing Behavior

**Strategy** — Swappable algorithms behind a common interface. Use when: multiple approaches to the same operation; user-selectable behavior; provider abstraction.
- Detect: Interface + multiple implementations; `XStrategy`, `XProvider` names; config-driven selection.
- Misuse: Strategy for a single implementation with no planned alternatives.

**Observer / EventEmitter** — Objects subscribe to notifications from a subject. Use when: one-to-many notifications; decoupled event handling.
- Detect: `.on()`, `.subscribe()`, `.addEventListener()`; `EventEmitter` usage; pub/sub patterns.
- Misuse: Observer between two tightly-coupled objects (just call a method).

**State Machine** — Object behavior changes based on internal state. Use when: complex state transitions with rules; workflow engines; protocol implementations.
- Detect: Switch/match on state; `status` fields with transition logic; state transition tables.
- Misuse: State machine for simple boolean flags.

**Command** — Encapsulates a request as an object. Use when: undo/redo; queuing operations; macro recording.
- Detect: Classes with `execute()` method; command queues; action objects.

**Middleware / Chain of Responsibility** — Request passes through a chain of handlers. Use when: HTTP request processing; plugin hooks; validation pipelines.
- Detect: `app.use()` patterns; `next()` callbacks; ordered handler arrays.
- Misuse: Chain with only one handler (just call it directly).

### Accessing Data

**Repository** — Abstraction over data access that presents a collection-like interface. Use when: separating domain logic from persistence; multiple data sources; testability.
- Detect: `XRepository` classes with `find()`, `save()`, `delete()`; data access layer.
- Misuse: Repository that just wraps an ORM with identical methods (adds nothing).

**Unit of Work** — Tracks changes to objects and coordinates writing them back. Use when: multiple related changes must be atomic; transaction management.
- Detect: Transaction wrappers; `commit()`/`rollback()` patterns.

**Data Mapper** — Separates domain objects from database representation. Use when: domain model differs from storage schema; complex mapping logic.
- Detect: Mapping functions between DB rows and domain objects; `toEntity()`, `toRow()`.

**Active Record** — Domain objects handle their own persistence. Use when: simple CRUD; domain closely mirrors the database; rapid prototyping.
- Detect: Model classes with `.save()`, `.delete()` on instances.
- Misuse: Active Record with complex domain logic (business rules mixed with persistence).

---

## Anti-Patterns & Smells

### Structural
| Smell | How to Detect | Cost | Typical Fix |
|-------|--------------|------|-------------|
| **God Object** | File >500 lines with many unrelated methods | Hard to test, understand, modify | Extract focused services |
| **Circular Dependencies** | Module A imports B, B imports A | Build failures, initialization order bugs | Introduce shared interface or restructure |
| **Feature Envy** | Method uses more data from another class than its own | Misplaced responsibility | Move method to the class whose data it uses |
| **Shotgun Surgery** | One change requires editing many files | High cost of change | Consolidate related logic into one module |

### Abstraction
| Smell | How to Detect | Cost | Typical Fix |
|-------|--------------|------|-------------|
| **Leaky Abstraction** | Callers need to know implementation details | Abstraction provides false safety | Fix the abstraction or remove it |
| **Speculative Generality** | Abstractions for hypothetical future needs | Complexity without benefit | YAGNI — remove until actually needed |
| **Dead Abstraction** | Interface with exactly one implementation, no plan for more | Unnecessary indirection | Inline it; add interface when a second impl appears |

### Coupling
| Smell | How to Detect | Cost | Typical Fix |
|-------|--------------|------|-------------|
| **Inappropriate Intimacy** | Module reaches into another's private state | Brittle coupling | Define explicit interface at the boundary |
| **Hidden Dependencies** | Module uses globals or singletons not in its interface | Surprises, hard to test | Make dependencies explicit (constructor/parameter injection) |
| **Global State** | Module-level mutable state shared across callers | Race conditions, test pollution | Scope state to instances; inject as dependency |

---

## Decision Matrix

| Situation | Consider These Patterns |
|-----------|------------------------|
| High change frequency in one area | Strategy, Plugin, Adapter |
| Multiple data sources or external integrations | Repository, Adapter, Hexagonal |
| Complex object creation with many variants | Factory, Builder |
| Cross-cutting concerns (logging, auth, caching) | Middleware, Decorator |
| Async coordination between subsystems | Observer, Event-Driven |
| Complex state transitions with rules | State Machine |
| Need to undo/replay operations | Command |
| Callers need simple API over complex internals | Facade |
| Same operation, different algorithms | Strategy |
| Hierarchical/recursive data structures | Composite |
| Separating domain logic from external dependencies | Hexagonal, Repository |
| Starting a new project, unclear boundaries | Monolith-First, Layered |
| Data transformation pipelines | Pipe-and-Filter, Middleware |
| Read-heavy vs write-heavy divergence | CQRS |
