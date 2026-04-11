---
name: dependency-direction-auditor
description: Use when reviewing import/dependency direction between layers, when infrastructure changes ripple into business logic, when domain code imports from controllers/routes/adapters or framework packages, or when testing business logic requires spinning up infrastructure. Trigger on "why do I need a database to test this?" or when tracing imports that cross layer boundaries. NOT for dependencies within a single layer, framework-internal wiring, or coupling strength between modules.
---

# Dependency Direction Auditor

A structural analysis framework based on Robert C. Martin's *Clean Architecture* (2017) and the Dependency Rule. Architecture is, at its core, about dependency direction — which parts of the system know about which other parts. When dependencies point the wrong way (domain depending on infrastructure), the most stable and valuable parts of your system become fragile. Every import that crosses a layer boundary is either reinforcing the architecture or undermining it.

**Core principle:** Source code dependencies must point inward — toward higher-level policy. Domain and business logic must never depend on infrastructure, frameworks, or delivery mechanisms. When the direction is wrong, the most stable parts of your system become fragile.

## When to Use

- Reviewing import/dependency direction between architectural layers
- When an infrastructure change (database, HTTP framework, queue) ripples into business logic
- When domain code imports from `controllers/`, `routes/`, `adapters/`, or framework-specific packages
- When testing business logic requires spinning up real infrastructure (database, message queue, external API)
- "Why do I need a database to test this business rule?"
- "Why does changing the API response format require modifying domain entities?"

**Not for:** Dependencies *within* a single layer (that's cohesion — see `cohesion-analyzer`). Framework-internal wiring (e.g., how Express middleware chains — that's the framework's design). Coupling *strength* between modules at the same layer (→ `coupling-auditor`).

## The Process

### 1. Map the Layers

Identify what constitutes each layer in the codebase. Not every project uses textbook names — infer from import patterns and responsibility:

**Domain / Entities (innermost)**
- Business objects, value objects, domain rules
- Pure logic with zero infrastructure imports
- Signal: files that define what the business *is* — `Order`, `Money`, `ShippingPolicy`

**Use Cases / Application**
- Orchestration of domain logic to fulfill a specific user goal
- Defines *what* the system does, not *how* infrastructure delivers it
- Signal: files that coordinate domain objects — `PlaceOrderUseCase`, `CalculateShippingService`

**Interface Adapters**
- Translates between the outside world's format and the application's format
- Controllers, presenters, mappers, serializers
- Signal: files that convert HTTP requests to use case inputs, or domain objects to API responses

**Infrastructure / Frameworks (outermost)**
- Database drivers, HTTP frameworks, queue clients, third-party SDKs, file system access
- Signal: files that import `knex`, `express`, `aws-sdk`, `nodemailer`, `pg`

For projects that don't have four distinct layers, identify at minimum: **core** (business logic) and **infrastructure** (everything else). The Dependency Rule still applies.

### 2. Trace Dependency Direction

For each import that crosses a layer boundary, classify it:

**Inward (correct):** An outer layer imports from an inner layer.
- Controller imports a use case → correct
- Infrastructure adapter imports a domain type → correct
- Use case imports a domain entity → correct

**Outward (violation):** An inner layer imports from an outer layer.
- Domain entity imports a database driver → violation
- Use case imports a concrete HTTP client → violation
- Domain type references an ORM decorator → violation

Name every violation specifically: `"src/domain/order.ts imports from src/infrastructure/db.ts at line 3"`. Don't just flag the concept — point to the exact import statement.

### 3. Classify Violations

Rank each outward dependency by severity:

**Hard violation**
- Domain or use case layer directly imports infrastructure code
- Example: `import { pool } from '../infrastructure/db'` inside a domain entity
- Risk: the innermost layer is now coupled to a specific infrastructure choice. Cannot test without that infrastructure. Cannot swap without rewriting domain logic.

**Soft violation**
- Application layer imports a concrete adapter instead of depending on an interface/port
- Example: `import { PostgresOrderRepo } from '../infrastructure/postgres-order-repo'` inside a use case
- Risk: the use case is coupled to a specific implementation. Swapping repos or testing in isolation requires changing the use case.

**Transitive violation**
- Inner layer code is clean, but a type it depends on drags in an infrastructure dependency
- Example: Domain type `Order` uses a type from an ORM library (`@Entity()` decorator), pulling Typeorm into the domain
- Risk: hidden coupling. The domain *looks* clean but cannot be used without the ORM installed.

### 4. Recommend Inversion

For each violation, propose a specific fix. The pattern is always the same:

1. Define an interface/port at the inner layer, in the inner layer's language
2. Implement that interface at the outer layer
3. Inject the implementation from outside (constructor, parameter, DI container)

Be specific: name the interface, where it lives, and what the outer layer's implementation looks like.

Example:
```
Violation: src/orders/service.ts:4 imports knex directly
Fix:
  1. Define interface OrderRepository in src/orders/ports.ts:
     - save(order: Order): Promise<void>
     - findById(id: string): Promise<Order | null>
  2. Create src/infrastructure/knex-order-repo.ts implementing OrderRepository
  3. Inject via constructor: new OrderService(new KnexOrderRepo(knex))
```

## Dependency Direction Report

For each violation found:

```
DEPENDENCY: [inner layer] ← [outer layer] (VIOLATION)
  Import:    [file:line — the specific import statement]
  Severity:  [hard / soft / transitive]
  Risk:      [what breaks or becomes untestable]
  Fix:       [specific interface to introduce, where it lives, what implements it]
```

Example:

```
DEPENDENCY: domain ← infrastructure (VIOLATION)
  Import:    src/domain/order.ts:3 — import { pool } from '../infrastructure/db'
  Severity:  hard — domain directly imports database driver
  Risk:      Order entity cannot be tested without a database connection; swapping from Postgres to DynamoDB requires rewriting domain logic
  Fix:       1) define OrderRepository interface in src/domain/ports/order-repository.ts
             2) move pool.query calls to src/infrastructure/postgres-order-repo.ts
             3) inject OrderRepository into OrderService constructor
```

## Interaction Model

Decision engine. The agent analyzes dependency direction in code it writes or reviews. When writing new code, it establishes layer boundaries before writing imports. When reviewing existing code, it traces every cross-layer import and flags outward dependencies. The agent prioritizes hard violations in the domain layer — those are the most damaging and the most urgent to fix.

## Martin's Dependency Rule (Reference)

1. **Source code dependencies must point inward.** Inner layers know nothing about outer layers — not their names, types, functions, or data formats.
2. **The inner layer defines the interface.** When an inner layer needs something from an outer layer, it defines an abstraction (interface/port) in its own language. The outer layer implements it.
3. **Data that crosses boundaries is simple.** Data structures passed inward should be plain data (DTOs, primitives), not framework-specific objects (HTTP Request, ORM entities).
4. **Nothing in an inner layer can mention anything in an outer layer.** This includes names, types, functions, and concrete classes. If the domain mentions "Postgres" or "Express," the rule is broken.
5. **The Dependency Rule applies at every boundary.** Not just domain-to-infrastructure, but also between application and adapters, and between adapters and frameworks.

## Guard Rails

**Scale to the project.** A 200-line script with one file doesn't have a dependency direction problem. A monolith with 50 modules does. Apply the analysis where layers exist or should exist.

**The Dependency Rule doesn't mean "no dependencies."** It means dependencies point toward stability and abstraction. Inner layers depend on abstractions they define. Outer layers depend on inner layers and implement their abstractions.

**Don't introduce interfaces where there's only one implementation and no testing benefit.** If a use case calls a single concrete repository, the function is trivially testable by constructing that repository with a test database, and there are no plans to swap implementations — an interface may be premature. The violation must cause real pain (untestable business logic, forced infrastructure coupling in tests, or blocked implementation swaps).

**Watch for the "interface that mirrors the concrete class" trap.** An interface with the exact same methods as the only concrete implementation is a sign that the interface exists for form, not function. Interfaces should describe what the inner layer *needs*, not what the outer layer *provides*.

**Transitive violations are the sneakiest.** A domain entity that looks clean but uses a type decorated with `@Entity()` from TypeORM has a transitive dependency on TypeORM. Check not just direct imports but the types of fields and parameters.

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Putting interfaces in the infrastructure layer | Interfaces belong in the layer that *uses* them (inner), not the layer that *implements* them (outer) |
| Domain objects decorated with framework annotations | Use plain objects in the domain; map to/from framework-specific shapes in the adapter layer |
| Passing framework objects through all layers | Convert to domain types at the boundary. Controllers receive HTTP Request → extract data → pass plain DTO to use case |
| "Clean Architecture means four directories" | The layers are conceptual, not physical. A small project may have two layers (core + infra). The principle is dependency direction, not directory count |
| Creating an interface for every dependency | Only introduce interfaces at boundaries where the inner layer would otherwise depend on the outer layer. Pure utility functions and standard library calls don't need interfaces |

## Cross-References

→ `port-adapter-auditor` — hexagonal architecture is the specific pattern for implementing the inversion this skill identifies as the fix.
→ `coupling-auditor` — measures coupling *strength* between modules at the same layer; this skill handles cross-layer *direction*.
→ `cohesion-analyzer` — when a dependency direction problem also manifests as a module with mixed-layer responsibilities, low cohesion is often the root cause.
