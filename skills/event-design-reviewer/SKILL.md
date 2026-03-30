---
name: event-design-reviewer
description: Use when designing domain events, naming events, defining event payloads, or reviewing event-driven communication between bounded contexts or services. Trigger on "what should this event be called?", "what data should the event carry?", "should this be an event or a command?", or when events are named after implementation details instead of domain concepts. NOT for UI event handlers (onClick, onChange) or framework-level events.
---

# Event Design Reviewer

An event design framework based on Eric Evans' *Domain-Driven Design* (2003), Vaughn Vernon's *Implementing Domain-Driven Design* (2013), and Udi Dahan's domain event patterns (2009). Events should describe what happened in the domain — not what changed in the database. A well-designed event is meaningful to a domain expert, carries exactly the data consumers need, and doesn't leak implementation details across bounded context boundaries.

**Core principle:** An event is a fact about something that happened in the domain. Not a database trigger, not a state diff, not a notification — a domain fact. "Order was placed" is a domain event. "Row inserted into orders table" is an implementation artifact. If a domain expert wouldn't understand the event name, it's designed wrong.

## When to Use

- Designing events for inter-service or inter-context communication
- Naming events for an event bus, message queue, or event store
- Defining what data an event should carry
- "What should this event be called?" / "What data should it carry?"
- Reviewing events that are named after database operations or implementation details
- Distinguishing between events, commands, and queries

**Not for:** UI event handlers (onClick, onChange — those are framework events, not domain events), in-process function calls, or log entries.

## The Process

### 1. Classify the Message Type

Before designing the event, verify it's actually an event and not something else:

**Event** — A fact about something that already happened. Past tense. Immutable. The producer doesn't care who consumes it or what they do with it.
- Examples: `OrderPlaced`, `PaymentProcessed`, `UserRegistered`, `InventoryReserved`
- Tense: always past tense — it already happened
- Authority: the producer is the authority — it states a fact
- Coupling: zero — the producer doesn't know about consumers

**Command** — A request for something to happen. Imperative. Directed at a specific handler. The sender expects it to be processed.
- Examples: `PlaceOrder`, `ProcessPayment`, `RegisterUser`, `ReserveInventory`
- Tense: imperative — do this thing
- Authority: the sender requests, the handler decides
- Coupling: one-to-one — command has exactly one handler

**Query** — A request for information. No side effects. Returns data.
- Examples: `GetOrderStatus`, `FindUserByEmail`, `ListInventory`
- Tense: imperative — tell me this thing
- Authority: the caller asks, the handler responds
- Coupling: one-to-one — query has exactly one responder

**The test:** If you're sending a message expecting a specific service to do a specific thing, that's a command, not an event. Events are broadcast facts; commands are directed requests.

### 2. Apply the Domain Expert Test

**Would a domain expert understand this event name?**

| Bad (implementation-leaked) | Good (domain-meaningful) |
|-----------------------------|--------------------------|
| `UserTableUpdated` | `UserProfileChanged` |
| `OrderRowInserted` | `OrderPlaced` |
| `PaymentRecordCreated` | `PaymentReceived` |
| `InventoryDecrementApplied` | `ItemShipped` |
| `CacheInvalidated` | (this isn't a domain event — it's infrastructure) |
| `DatabaseSynced` | (this isn't a domain event — it's infrastructure) |
| `StateChanged` | (too vague — changed how? what state?) |
| `DataUpdated` | (meaningless — what data? what happened?) |

**The naming rules:**
1. Past tense: something happened (`OrderPlaced`, not `PlaceOrder`)
2. Domain language: use terms the business uses, not technical terms
3. Specific: `OrderCancelled` not `OrderUpdated` (what kind of update?)
4. No implementation leaks: no mention of databases, tables, caches, queues
5. No CRUD names: not `Created`, `Updated`, `Deleted` — what actually happened in the domain?

### 3. Design the Event Payload

**Carry enough data for consumers to act without calling back to the producer.**

An event that says "OrderPlaced" but carries only `{ orderId: "123" }` forces every consumer to call the order service to get the details. This creates runtime coupling — the "decoupled" event-driven architecture is actually synchronously dependent on the producer being available.

**Payload design rules:**

**Include:** Data the consumer needs to process the event without additional calls
- The entity's key identifier
- The data that changed (for state-change events)
- Contextual data consumers commonly need (user, timestamp, correlation ID)

**Exclude:** Data that ties the consumer to the producer's internal model
- Internal IDs that only make sense within the producing service
- Full entity snapshots when only the delta matters
- Implementation details (database row versions, internal status enums)

**The fat vs. thin event decision:**

| Thin event (ID + type only) | Fat event (includes relevant data) |
|-----------------------------|--------------------------------------|
| `{ orderId: "123" }` | `{ orderId: "123", items: [...], total: 99.50, currency: "USD" }` |
| Pro: small, never stale | Pro: consumers are truly decoupled — no callback needed |
| Con: consumers must call producer for data | Con: larger payload, potential for stale data if event replayed |
| Use when: consumers always need fresh data, payload would be enormous | Use when: consumers need to act immediately without additional queries |

**Default to fat events.** Thin events that require callbacks create temporal coupling — if the producer is down, consumers can't process events. Fat events enable true decoupling.

### 4. Design the Event Schema

**Every event should have a consistent envelope:**

```
{
  "eventType": "OrderPlaced",          // Domain name, PascalCase
  "eventId": "uuid-v4",                // Unique per event instance
  "occurredAt": "ISO-8601 timestamp",  // When it happened in the domain
  "correlationId": "uuid-v4",          // Traces the business flow across events
  "causationId": "uuid-v4",            // The event/command that caused this event
  "version": 1,                        // Schema version for evolution
  "source": "order-service",           // Which bounded context produced this
  "data": {                            // The domain-specific payload
    // ... event-specific fields
  }
}
```

**Required envelope fields:**
- `eventType` — consumers route on this; must be stable and meaningful
- `eventId` — enables idempotent consumers (deduplicate by ID)
- `occurredAt` — domain time, not publish time (they may differ)
- `correlationId` — traces a business operation across multiple events
- `version` — enables schema evolution without breaking consumers

### 5. Check for Event Design Smells

| Smell | Problem | Fix |
|-------|---------|-----|
| CRUD events (`UserCreated`, `UserUpdated`, `UserDeleted`) | "Updated" is meaningless — updated how? | Name the domain action: `UserRegistered`, `UserEmailChanged`, `UserDeactivated` |
| Generic events (`DataChanged`, `StateUpdated`) | Consumers can't route or filter meaningfully | Split into specific domain events for each meaningful state change |
| Events named after infrastructure (`CacheInvalidated`, `QueueFlushed`) | These are infrastructure concerns, not domain events | Don't publish these as domain events. Keep them internal to the service. |
| Events with the full entity snapshot as payload | Consumers are coupled to the producer's data model | Include only the data relevant to what happened |
| Events without version field | Schema changes break all consumers simultaneously | Add version from the start; support multiple versions during migration |
| Events without correlation ID | Business flows spanning multiple events are untraceable | Add correlation ID in the envelope; propagate across all events in a flow |
| Events named in present tense (`OrderPlacing`) | Confuses events with in-progress operations | Past tense: `OrderPlaced`. If it's in-progress, it may not complete — it's not a fact yet. |
| Bi-directional events (service A emits event, service B responds with event, A responds...) | Event ping-pong — disguised RPC | If services need to coordinate, use a saga or orchestrator, not event volleys |

### 6. Event Design Report

```
EVENT DESIGN: [event name]
  Type:         [event / command / query — is this actually an event?]
  Domain test:  [would a domain expert understand this name?]
  Naming:       [past tense? domain language? specific? no implementation leak?]
  Payload:      [fat / thin — does it enable consumer independence?]
  Envelope:     [eventId, correlationId, version present?]
  Smells:       [specific design issues found]
  Fix:          [specific naming, payload, or schema changes]
```

Example:

```
EVENT DESIGN: UserUpdated
  Type:         event (correct — it's a fact about something that happened)
  Domain test:  FAIL — "updated" is meaningless. Updated how? A domain expert would ask "what changed?"
  Naming:       wrong — present-tense-ish, generic CRUD name, doesn't describe the domain action
  Payload:      thin — only carries { userId }, forcing consumers to query user service
  Envelope:     missing correlationId and version field
  Smells:       CRUD naming, thin payload creates temporal coupling, no schema versioning
  Fix:          split into specific events: UserEmailChanged { userId, oldEmail, newEmail },
                UserRoleAssigned { userId, role, assignedBy }, UserDeactivated { userId, reason }.
                Each carries relevant data. Add correlationId and version to envelope.
```

## Interaction Model

Hybrid. The agent evaluates event names, payloads, and schemas independently against domain event principles. But it asks the human for domain context:

- "What actually happened from the business perspective when this event fires?"
- "What do consumers need to know to act on this event without calling you back?"
- "Is 'UserUpdated' one event or multiple distinct domain actions that should be separate events?"

Event naming is a domain decision. The agent enforces the principles but the human provides the domain language.

## Guard Rails

**Not everything is a domain event.** Logging, cache invalidation, metric emission, and health checks are infrastructure concerns. They don't belong on the domain event bus.

**Event granularity is a judgment call.** `OrderPlaced` vs. `OrderItemAdded` + `OrderShippingSelected` + `OrderPaymentAuthorized` — the right granularity depends on consumer needs. The agent should ask, not prescribe.

**Schema evolution is inevitable.** Events will change. Design for it from day one: version field, backward-compatible additions, consumer tolerance for unknown fields.

**Perfect events don't exist in iteration one.** It's better to ship a reasonable event and evolve it than to block on designing the perfect schema. The principles guide the direction, not the final destination.

## The Evans/Vernon/Dahan Framework (Reference)

**Evans (2003):** Bounded contexts define where domain events originate and terminate. An event that crosses a context boundary is an integration event and may need schema translation.

**Vernon (2013):** Domain events are raised within the aggregate that owns the state change. The aggregate guarantees consistency; the event communicates the fact.

**Dahan (2009):** Domain events vs. integration events. Domain events are internal to a bounded context (can carry rich domain types). Integration events cross boundaries (must use a shared, stable schema).

| Concept | Domain Event | Integration Event |
|---------|-------------|-------------------|
| Scope | Within a bounded context | Across bounded contexts |
| Schema | Can use internal domain types | Must use shared, stable types |
| Coupling | Low (same team, same deployment) | Must be zero (different teams, different deployments) |
| Evolution | Can change with the domain model | Must be backward-compatible |
| Examples | `CartItemAdded` (internal) | `OrderPlaced` (published to other services) |

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Naming events after database operations | Name after domain actions. "What happened in the business?" |
| Publishing internal domain events externally | Define separate integration events with stable schemas |
| Thin events that require callbacks | Default to fat events — include data consumers need |
| No event versioning | Add version field from day one |
| Using events as commands (expecting specific handlers) | Events are broadcast facts. If you need a specific handler, send a command. |
| Event ping-pong between services | Use a saga or process manager for multi-step coordination |
