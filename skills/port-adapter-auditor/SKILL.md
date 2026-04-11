---
name: port-adapter-auditor
description: Use when business logic is tangled with database queries, HTTP handling, or third-party SDK calls, when testing a feature requires standing up real infrastructure, or when swapping an infrastructure dependency would require rewriting business logic. Trigger on "I can't test this without a database", "swapping the email provider means rewriting half the service", or when reviewing boundaries between core and infrastructure. NOT for dependency direction between layers, internal module structure within the core, or API contract design.
---

# Port-Adapter Auditor

A structural analysis framework based on Alistair Cockburn's Hexagonal Architecture (2005), also known as Ports and Adapters. The architecture divides an application into two zones: the inside (business logic, domain rules, use cases) and the outside (everything else — databases, web frameworks, email providers, payment gateways, message queues). The inside is the application's core. The outside is infrastructure. They communicate through ports — interfaces defined by the core in its own language — and adapters — concrete implementations provided by infrastructure. The core never imports from infrastructure; infrastructure imports from the core and provides implementations of ports. This decoupling allows the core to be tested without standing up databases, calling real APIs, or spinning up services.

**Core principle:** The application's core defines what it needs through interfaces (ports) in its own language. Infrastructure provides implementations (adapters). The core never knows which adapter is plugged in, and adapting to new infrastructure should never require touching core logic.

## When to Use

- Business logic is tangled with database queries, HTTP handling, or third-party SDK calls
- Testing a feature requires standing up real infrastructure (database, cache, message broker)
- Swapping an infrastructure dependency (e.g., PostgreSQL → MongoDB, email provider) requires rewriting business logic
- Questions like "I can't test this without a database" or "swapping the email provider means rewriting half the service"
- Reviewing boundaries between core (domain) and infrastructure layers
- Analyzing why a change to infrastructure broke business logic tests
- Designing ports before building adapters for a new feature

**Not for:** Dependency direction between layers in general (use dependency-direction-auditor for that), internal module structure within the core (use coupling-auditor for that), or API contract design between services (use contract-enforcer for that).

## The Process

### 1. Identify the Core

The core is the application's reason for existing. It contains domain entities, business rules, and use cases. It does not contain SQL, HTTP handling, or SDK calls.

**What belongs in the core:**
- Domain entities (Order, Invoice, User)
- Business rules (order total = sum of items + tax, orders over $100 get free shipping)
- Use cases (CreateOrder, RefundPayment, SendInvoice)
- Domain errors and exceptions

**What leaks into the core:** (red flags)
- SQL queries or ORM imports (Order.findById = direct database access)
- HTTP request/response handling (CreateOrderHandler receiving `req: HttpRequest`)
- Third-party SDK imports in use case logic (PaymentUseCase importing `stripe-sdk`)
- Configuration objects specific to infrastructure (Order knowing about PostgreSQL connection pool)

Example core:
```
src/
  domain/
    entities/
      Order.ts       (id, items, total, customer, createDate)
      Customer.ts    (id, name, email, address)
    rules/
      OrderTax.ts    (calculateTax(order, region): Money)
      FreeShipping.ts (qualifies(order): boolean)
  usecases/
    CreateOrder.ts   (execute(command: CreateOrderCommand): Order)
    RefundOrder.ts   (execute(orderId: string): RefundResult)
```

### 2. Identify Ports

Ports are interfaces the core defines, in the core's own language. They represent things the core needs from the outside world.

**Two kinds of ports:**

**Driving ports (primary/inbound)** — things that initiate interaction with the core
- Use case interfaces that application controllers/handlers call
- Example: `CreateOrderUseCase`, `GetOrderDetailsUseCase`
- Naming: verb-noun, what the use case does
- Location: in the core, alongside use cases
- Callers: HTTP controllers, CLI handlers, message consumers (adapters)

**Driven ports (secondary/outbound)** — things the core depends on to complete its work
- Repository interface (core's language for data access)
- Notifier interface (core's language for sending notifications)
- Gateway interface (core's language for third-party integrations)
- Example: `OrderRepository` (not a SQL query), `EmailNotifier`, `PaymentGateway`
- Naming: noun + interface purpose (Notifier, Gateway, Repository)
- Location: in the core, alongside the use case that needs it
- Callers: use cases (core logic), implementations (adapters in infrastructure)

Example ports:
```
src/
  domain/
    ports/
      OrderRepository.ts        (interface: create(order), getById(id), save(order))
      PaymentGateway.ts         (interface: charge(amount, card): PaymentResult)
      EmailNotifier.ts          (interface: send(to, subject, body): void)
      InvoiceGenerator.ts       (interface: generate(order): Pdf)
```

### 3. Identify Adapters

For each port, adapters are the concrete implementations living outside the core.

**Driving adapters (for driving ports):**
- HTTP controller that receives request and calls use case
- CLI handler that parses arguments and calls use case
- Message consumer that receives event and calls use case
- Location: in infrastructure layer
- Example: `src/infrastructure/http/OrderController.ts` implements driving into `CreateOrderUseCase`

**Driven adapters (for driven ports):**
- Database adapter implements `OrderRepository` using a specific database
- Email adapter implements `EmailNotifier` using a specific provider
- Payment adapter implements `PaymentGateway` using Stripe/PayPal/etc.
- Location: in infrastructure layer, organized by concern
- Example: `src/infrastructure/persistence/PostgresOrderRepository.ts` implements `OrderRepository`

Example adapter locations:
```
src/
  infrastructure/
    http/
      OrderController.ts        (driving adapter for CreateOrderUseCase)
      GetOrderController.ts     (driving adapter for GetOrderDetailsUseCase)
    persistence/
      PostgresOrderRepository.ts (driven adapter for OrderRepository)
    payment/
      StripePaymentGateway.ts   (driven adapter for PaymentGateway)
    email/
      SendgridEmailNotifier.ts  (driven adapter for EmailNotifier)
```

### 4. Classify Boundary Health

For each port, evaluate the port-adapter relationship:

**Clean port-adapter** (goal)
- Port exists in core, in core's language
- Adapter exists outside core, imports from core
- Core never imports from adapter
- Testability: core can be tested with mock adapter
- Example:
  ```
  // Core defines port
  src/domain/ports/OrderRepository.ts
  interface OrderRepository {
    save(order: Order): void
    getById(id: string): Order | null
  }
  
  // Adapter implements port
  src/infrastructure/persistence/PostgresOrderRepository.ts
  class PostgresOrderRepository implements OrderRepository {
    constructor(private db: Database) {}
    save(order: Order): void { /* SQL */ }
    getById(id: string): Order | null { /* SQL */ }
  }
  
  // Use case uses port (injected)
  src/domain/usecases/CreateOrder.ts
  class CreateOrder {
    constructor(private repo: OrderRepository) {}
    execute(cmd: CreateOrderCommand): Order {
      const order = new Order(cmd)
      this.repo.save(order)  // Uses port, not adapter
      return order
    }
  }
  ```

**Missing port** (core calls infrastructure directly)
- Core directly imports and uses infrastructure library
- No port exists
- Testability: must use real infrastructure
- Example (bad):
  ```
  // Core logic directly uses ORM
  src/domain/usecases/CreateOrder.ts
  import { Database } from 'postgres'  // BAD: core imports infrastructure
  class CreateOrder {
    constructor(private db: Database) {}
    execute(cmd: CreateOrderCommand): Order {
      const order = new Order(cmd)
      this.db.query('INSERT INTO orders...')  // BAD: SQL in core
      return order
    }
  }
  ```

**Port exists but adapter leaks** (core constructs adapter)
- Port exists, but core constructs/configures the adapter
- Core imports adapter implementation
- Testability: partially, but core is not truly isolated
- Example (bad):
  ```
  // Core constructs the adapter
  src/domain/usecases/CreateOrder.ts
  import { PostgresOrderRepository } from '../infrastructure/persistence'  // BAD
  class CreateOrder {
    constructor() {
      this.repo = new PostgresOrderRepository()  // BAD: core constructs adapter
    }
  }
  ```

**Wrong language in port** (infrastructure terms in core interface)
- Port uses infrastructure terminology, not domain terminology
- Core knows about the outside world
- Example (bad):
  ```
  // Port leaks database concepts
  interface OrderRepository {
    sqlQuery(sql: string): any[]  // BAD: infrastructure language
    getConnection(): DbConnection  // BAD: database-specific
  }
  
  // Should be:
  interface OrderRepository {
    save(order: Order): void  // domain language
    getById(id: string): Order | null
  }
  ```

**Adapter in the core** (concrete implementation lives in core)
- Concrete implementation (e.g., database class) lives alongside domain logic
- Core is polluted with infrastructure details
- Testability: no separation
- Example (bad):
  ```
  src/domain/
    entities/
    usecases/
    infrastructure/
      DatabaseConnection.ts  // BAD: infrastructure code in domain directory
      OrderRepository.ts     (concrete, not port)
  ```

### 5. Port-Adapter Report Format

For each port analyzed:

```
PORT: [name]
  Direction:    [driving/driven]
  Interface:    [file:line or "MISSING"]
  Language:     [domain-native/infrastructure-leaking]
  Adapter(s):   [implementation location(s)]
  Injection:    [injected/hardcoded/constructed-in-core]
  Testability:  [yes/no]
  Fix:          [action if unhealthy]
```

Example reports (one unhealthy, one healthy):

```
PORT: OrderRepository (UNHEALTHY)
  Direction:    driven (outbound)
  Interface:    MISSING
  Language:     N/A (port doesn't exist)
  Adapter(s):   src/domain/usecases/CreateOrder.ts line 14 (concrete, embedded in core)
  Injection:    hardcoded — CreateOrder instantiates Database directly
  Testability:  NO — must use real database to test CreateOrder
  Fix:          Create OrderRepository interface in src/domain/ports/OrderRepository.ts. Move concrete PostgresOrderRepository to src/infrastructure/persistence/. Inject repository into CreateOrder constructor.
```

```
PORT: PaymentGateway (HEALTHY)
  Direction:    driven (outbound)
  Interface:    src/domain/ports/PaymentGateway.ts (line 3)
  Language:     domain-native (charge(amount, card), PaymentResult, PaymentError)
  Adapter(s):   src/infrastructure/payment/StripePaymentGateway.ts
  Injection:    injected — ProcessPaymentUseCase receives gateway via constructor
  Testability:  YES — core can be tested with mock gateway
  Fix:          None. This port is clean.
```

## Interaction Model

Decision engine. The agent prioritizes driven ports (outbound) first because they have the most impact on testability and swappability. For each driven port, it checks: Does a port interface exist? Is it in the core? Does it use domain language? Is the adapter injected or constructed in core? The agent produces a ranked list of port-adapter violations sorted by severity (missing port → worst; wrong language → bad; adapter leaks → medium; all others → note).

## Cockburn's Hexagonal Architecture Principles (Reference)

1. **The application has a purpose.** It's not just layers of code — it has a core that embodies its reason for existing (business rules, domain logic).
2. **The application communicates over ports.** Every external interaction goes through a port defined by the core in its own language.
3. **Adapters translate.** Every external system gets an adapter that speaks the core's language on one side and the external system's language on the other.
4. **The outside is symmetrical.** There's no inherent "top" or "bottom." All external systems (database, web, message queue) are equally outside; all get adapters.
5. **The core is testable in isolation.** With mock adapters, the core's business logic can be tested without any infrastructure.

## Guard Rails

**Not every call needs a port.** Don't create a port for every tiny thing. Ports are for things that could realistically change or need testing in isolation. A port for logging might be overkill; a port for database access or payment processing is essential.

**One port per concern.** A port represents a concern the core has. `OrderRepository` is one concern. `PaymentGateway` is another. Don't bundle unrelated things into one port.

**Ports should be small.** A port with 20 methods is probably doing too much. If the core needs something, it should be clear from the port name what that something is.

**Don't over-abstract simple apps.** Hexagonal architecture's value grows with complexity and team size. For a tiny script, forcing the architecture might be overhead. For a large service with multiple databases, payment providers, and email services, it's essential.

**Adapters can depend on libraries; ports cannot.** An adapter can import Stripe SDK, ORM libraries, HTTP frameworks. A port cannot. Ports are library-agnostic.

**Beware ports that mirror adapters.** If your port looks exactly like your adapter's public interface, the port hasn't abstracted anything. It's just a pass-through. The port should translate between domain language and adapter language.

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Core depends on ORM entities | Core should define Order. Database returns ORM Order. Adapter translates ORM → domain Order. Core never sees the ORM. |
| Port returns infrastructure types | `OrderRepository.getById()` returns an ORM entity. Should return a domain Order. Adapter translates. |
| Adapter does business logic | Business logic belongs in core. Adapter translates and delegates. If you find logic in an adapter, move it to core. |
| One giant service (no ports) | Even monoliths need internal hexagons. Define ports between core and persistence, core and messaging, etc. |
| Testing adapters instead of core | Don't write tests for adapters (they test the library). Write tests for core with mock adapters. Adapter tests are integration tests, not unit tests. |
| Ports for internal collaboration | Ports are for external systems (database, API, messaging). Internal communication between core modules uses dependency injection, not ports. |
| Circular imports | Core imports adapter to construct it (bad). Use a composition root outside core to wire dependencies. Core only imports ports. |

## Cross-references

- **dependency-direction-auditor**: For analyzing dependency direction across layers; complements port-adapter analysis by checking if dependencies point correctly.
- **contract-enforcer**: For designing contracts between services; port definitions are internal contracts, but service boundaries have their own concerns.
