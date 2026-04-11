---
name: idempotency-guardian
description: Use when designing or reviewing API endpoints that mutate state, reviewing event/message handlers, when retry logic exists anywhere in the system, when debugging duplicate side effects (double charges, duplicate emails, duplicated records), or when designing webhook/callback handlers. Trigger on "why did the customer get charged twice?", "the queue redelivered and now we have duplicate rows", or when writing handlers for external input. NOT for read-only operations, pure functions, or coupling/dependency structure.
---

# Idempotency Guardian

A distributed systems analysis framework based on Pat Helland's *Idempotence Is Not a Medical Condition* (2012), the HTTP specification (RFC 7231), and messaging literature (Hohpe & Woolf's *Enterprise Integration Patterns*). Networks are unreliable. Messages get retried, consumers process the same event twice, payments get resubmitted, webhooks fire multiple times. The fundamental question is never "will this be called twice?" — it will be. The real question is: "when this is called twice with the same input, will the system still be correct?" An idempotent operation produces the same result whether executed once or multiple times. Idempotency is not an optimization or a nice-to-have — it's the minimum safety property for anything that can be called more than once. Without it, retries cause data corruption, duplicate side effects, and cascading failures.

**Core principle:** An idempotent operation produces the same observable result whether executed once or executed multiple times with the same input. Idempotency is the only reliable way to handle retries, at-least-once delivery, and network unreliability. State changes should be idempotent; side effects require explicit protection.

## When to Use

- Designing or reviewing API write endpoints (POST, PUT, DELETE)
- Reviewing event/message handlers, especially in at-least-once delivery systems
- Any place where retry logic exists (HTTP client retries, message queue redelivery, cron job recovery)
- Debugging duplicate side effects (customers charged twice, duplicate emails sent, rows duplicated in database)
- Designing webhook or callback receivers
- Payment flows, financial transactions, any high-consequence operations
- Designing idempotency keys into APIs

**Not for:** Read-only operations (GET, SELECT), pure functions with no side effects, or coupling/dependency structure (use coupling-auditor for that).

## The Process

### 1. Identify Mutation Points

Mutation points are places where the system changes state or triggers side effects. Find every place where data is created, updated, deleted, or where external systems are called:

**API write endpoints:** POST, PUT, PATCH, DELETE
- CreateOrder: POST /api/orders
- UpdateInvoice: PUT /api/invoices/:id
- ProcessRefund: POST /api/refunds
- DeleteAccount: DELETE /api/users/:id

**Event/message handlers:** services that process events from queues, topics, or event streams
- OrderCreatedHandler: consumes OrderCreated event
- PaymentCompletedHandler: consumes PaymentCompleted event
- InventoryReservedHandler: consumes InventoryReserved event

**Webhook/callback receivers:** endpoints that receive notifications from external systems
- StripeWebhook: POST /api/webhooks/stripe
- ShipmentTracking: POST /api/webhooks/shipment
- ZapierCallback: POST /api/callbacks/zapier

**Scheduled jobs:** cron tasks, batch processes that mutate state
- SettleTransactions (nightly batch)
- RefreshInventory (hourly sync)
- GenerateInvoices (daily)

**Database operations triggered by external input:** any write that depends on a request

For each mutation point, name it specifically: "POST /api/orders → CreateOrderHandler at src/api/orders/create.ts:45"

### 2. Classify Natural Idempotency

Operations have different natural idempotency properties. Understand which operations are naturally safe and which require protection:

**Naturally idempotent** (safe to retry without protection)
- SET operations (update field to a specific value): `SET status = 'shipped'` — running twice changes nothing
- PUT with full replacement: `PUT /api/orders/123 { customer: "Alice", items: [...] }` — replaces entire order, second call changes nothing
- DELETE by ID: `DELETE /api/orders/123` — deleting a deleted record is safe (idempotent delete)
- Upsert with natural key: `INSERT ... ON CONFLICT (email) DO UPDATE ...` — second attempt finds existing record, updates it or does nothing

**Naturally non-idempotent** (require explicit protection)
- Increment/decrement: `inventory -= 1` — calling twice decrements twice (bad)
- INSERT without dedup: `INSERT INTO payments (amount, customer_id) VALUES (...)` — second call inserts duplicate row
- POST with server-generated IDs: `POST /api/orders` returns id=123; retry sends same order again, gets id=456 (duplicate order)
- Side effects (email, SMS, charge, event): calling twice sends email twice, charges card twice
- APPEND operations: `array.push()` — calling twice appends twice
- Counter/cumulative updates: `total_spent += 100` — calling twice adds 200 instead of 100

Example classification:

```
Natural idempotency:
  SET order.status = 'shipped'             → NATURALLY IDEMPOTENT
  PUT /api/orders/123 { full replacement } → NATURALLY IDEMPOTENT
  DELETE /api/orders/123                   → NATURALLY IDEMPOTENT
  INSERT ... ON CONFLICT ... UPDATE        → NATURALLY IDEMPOTENT (with natural key)

Naturally non-idempotent:
  POST /api/orders (server generates ID)   → NON-IDEMPOTENT
  inventory -= 1                           → NON-IDEMPOTENT
  SendEmail(customer, subject, body)       → NON-IDEMPOTENT
  ProcessPayment(card, amount)             → NON-IDEMPOTENT
  INSERT row                               → NON-IDEMPOTENT
  message.send()                           → NON-IDEMPOTENT
```

### 3. Check Protection Mechanisms

For each non-idempotent operation, identify which protection mechanism is used (or if none exists). There are four main mechanisms:

**Idempotency Key** (client-provided, server deduplication)
- Client generates unique key (UUID), sends with request: `POST /api/orders { items: [...], idempotencyKey: "123e4567-e89b-12d3-a456-426614174000" }`
- Server atomically checks: "Have I seen this key before?"
- If yes: return cached response (don't re-execute)
- If no: execute operation, store key→result mapping
- Requirements:
  - Check must happen before execution (race condition window: atomic check-and-store)
  - Response must be cached (if you execute but lose the response, retry breaks)
  - Key must expire (eventually clean up old keys, probably after 24-72 hours)
  - HTTP: idempotency keys usually passed as `Idempotency-Key` header

**Natural Key / Upsert**
- Operation uses a unique constraint to guarantee single execution
- Example: `INSERT INTO users (email, name) VALUES (...) ON CONFLICT (email) DO UPDATE ...`
- The natural key (email) ensures the operation is idempotent
- Second execution with same email finds the existing row, updates or skips
- Requires: your data model has a natural key that uniquely identifies the operation

**Optimistic Concurrency Control**
- Client sends version/ETag of resource: `PUT /api/orders/123 { total: 150 } [If-Match: "v2"]`
- Server checks version: "Is the current version still v2?"
- If yes: update and return new version (e.g., v3)
- If no: reject with 409 Conflict (version mismatch — retry from scratch)
- Provides idempotency for updates where you want to detect concurrent changes
- Requires: versioning of resources (Etag, revision number, timestamp)

**Deduplication Log** (message ID tracking)
- Message broker provides Message ID; consumer tracks processed IDs
- Before executing, check: "Have I processed this message ID?"
- If yes: skip (we're seeing it again after a retry/redelivery)
- If no: execute, then store ID in processed log (atomically with side effects)
- Atomic operation is critical: store message ID and side effects in same transaction
- Used in event/message handlers, webhook receivers

**None** (no protection)
- No mechanism in place
- Risk: retries cause side effects to execute multiple times

Example mechanisms:

```
Mutation: POST /api/orders
  Protection: Idempotency Key (Idempotency-Key header checked before execute)

Mutation: PATCH /api/invoice/123
  Protection: Optimistic concurrency (If-Match: ETag)

Mutation: OrderCreatedHandler (event consumer)
  Protection: Deduplication log (message ID tracking in processed_events table)

Mutation: POST /api/users
  Protection: Natural key (email unique constraint)

Mutation: POST /api/payments
  Protection: NONE ← Red flag
```

### 4. Evaluate Side Effect Safety

A side effect is any observable change to a system outside your control: sending an email, calling a payment processor, emitting an event, writing to a log, etc. If a mutation has side effects and can be retried, each side effect must be safe on retry.

For each side effect in a mutation:

1. **Identify the side effect:** what external system is affected?
2. **Can it be retried safely?**
   - Email: sending same email twice = duplicate (bad) unless provider deduplicates (usually doesn't)
   - Payment charge: charging twice = double charge (catastrophic)
   - Event emission: emitting same event twice = duplicate event processed twice (bad if consumer not idempotent)
   - Database write: covered by transaction, but external calls aren't
   - Log: duplicate log entries (usually acceptable)

3. **Is there protection?**
   - Protected if idempotency key prevents re-execution (side effect never fires twice)
   - Protected if side effect itself is idempotent (e.g., SET invoice.sent = true twice is safe)
   - Protected if side effect is guarded by the same deduplication (email task ID tracked, task only runs once)
   - Unprotected if re-execution fires the side effect again

Example side effect analysis:

```
Mutation: POST /api/orders
  Side effects:
    1. Insert order in database        → Protected (inside transaction, only runs if idempotency key check passes)
    2. Emit OrderCreated event         → UNPROTECTED (if request is retried, event fires twice; downstream processes duplicate order)
    3. Send confirmation email         → UNPROTECTED (if request is retried, email sent twice)
  Fix: Emit event and send email inside the transaction, or defer with exactly-once guarantee

Mutation: ProcessPaymentHandler (event consumer)
  Side effects:
    1. Charge credit card (Stripe)     → UNPROTECTED (if message redelivered, card charged twice)
    2. Update payment status in DB     → Protected (atomic with dedup, only runs once)
    3. Emit PaymentProcessed event     → Protected (same transaction as dedup)
  Fix: Use idempotency key at Stripe (attach request_id to charge), or track Stripe charge ID to prevent double charge
```

### 5. Idempotency Report Format

For each mutation point analyzed:

```
MUTATION: [endpoint/handler]
  Location:           [file:line]
  Type:               [API endpoint / event handler / webhook / scheduled job]
  Operation:          [what it does — create order, update invoice, process payment]
  Natural:            [naturally idempotent / non-idempotent]
  Protection:         [Idempotency Key / Natural Key / Optimistic Concurrency / Deduplication Log / NONE]
  Side effects:       [list of external systems affected]
  Side effect safety: [each effect: protected / UNPROTECTED]
  Risk:               [what happens if called twice — duplicate charge, duplicate email, etc.]
  Fix:                [specific mechanism to protect]
```

Example reports (one with missing protection, one healthy):

```
MUTATION: POST /api/orders (UNHEALTHY)
  Location:           src/api/orders/create.ts:45
  Type:               API endpoint
  Operation:          CreateOrder — creates new order, emits event, sends confirmation email
  Natural:            non-idempotent (server generates order ID)
  Protection:         NONE
  Side effects:       1. Insert order in DB, 2. Emit OrderCreated event, 3. Send confirmation email
  Side effect safety: 1. DB (duplicate row), 2. Event (fires twice), 3. Email (sent twice)
  Risk:               Retry sends confirmation email twice, publishes event twice (downstream processes order twice), inserts duplicate row
  Fix:                Add Idempotency-Key header check (atomic check-and-cache). Move event and email into same transaction as order insert. Or: use event sourcing + dedup consumer.
```

```
MUTATION: handleOrderCreated event handler (HEALTHY)
  Location:           src/handlers/OrderCreatedHandler.ts:12
  Type:               event handler (SQS consumer)
  Operation:          Reserve inventory, emit InventoryReserved event
  Natural:            non-idempotent (reserve operation decrements inventory)
  Protection:         Deduplication Log (message ID tracked in processed_events table, atomic with operation)
  Side effects:       1. Decrement inventory, 2. Emit InventoryReserved event
  Side effect safety: 1. Protected (dedup check prevents re-execution), 2. Protected (same transaction as dedup)
  Risk:               SQS redelivery will call handler twice, but dedup check prevents double execution
  Fix:                None. This handler is safe.
```

## Interaction Model

Decision engine, prioritizes by blast radius (financial > external API > data integrity > notifications). The agent scans for mutation points, classifies natural idempotency, checks for protection mechanisms, and evaluates side effect safety. It produces a ranked list of unprotected mutations sorted by risk: unprotected payments → critical, unprotected events → high, unprotected database writes → medium, unprotected emails → low.

## Helland's Idempotency Principles (Reference)

1. **At-least-once delivery is the reality.** Networks fail, processes crash, messages get retried. Assume every request/message might be delivered more than once.
2. **Idempotency makes at-least-once equivalent to exactly-once.** If your operation is idempotent, receiving a message twice has the same effect as receiving it once.
3. **The entity is the unit of idempotency.** Idempotency keys, natural keys, and dedup logs all track identity at the entity level (order, payment, message).
4. **Idempotency requires memory.** You must remember which requests you've already processed. This memory must be reliable (durable, transactional).
5. **Side effects are the hard part.** Making state changes idempotent is relatively easy (upsert, natural keys). Making side effects safe is hard (external API calls, emails, events).

## Guard Rails

**State changes should be idempotent. Side effects require explicit protection.** Don't confuse them. Making an INSERT idempotent via upsert is straightforward. Making sure email is only sent once requires additional work (dedup, guard checks, or moving email into the same transaction).

**"Just deduplicate" is not sufficient.** Deduplication prevents re-execution of the operation but not of its side effects. If you've already called Stripe.charge() and saved the result, dedup prevents you from calling it again — but only if you deduplicate before calling the external API.

**Idempotency keys need lifecycle management.** You can't keep them forever. Set an expiry (24-72 hours is typical). After expiry, the same key can be reused. This is fine because the operation likely won't be retried after that time window.

**Don't confuse idempotent with safe.** An operation can be idempotent but still unsafe (e.g., if it reads stale data). Idempotency is about repeated execution of the operation, not about correctness under concurrent execution.

**Distributed side effects are the hardest part.** If your operation calls multiple external systems (Stripe + SendGrid + analytics), protecting all of them is complex. Options: use outbox pattern (record intent, external daemon delivers), use orchestration (record state machine, step through atomically), or accept some risk.

**Idempotency doesn't replace validation.** An idempotent operation that accepts invalid input is still broken. Validate before applying idempotency logic.

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Assuming retries won't happen | They will. Plan for at-least-once delivery. |
| Checking dedup after side effects | Check dedup *before* calling external APIs. Dedup after means you've already charged the card. |
| Timestamps as idempotency keys | Timestamps have collisions (millisecond precision, multiple requests in same ms). Use UUIDs. |
| Race condition window in dedup | Check and store must be atomic. Check-then-act has a window where the same key is processed twice. |
| Handler idempotent but side effects aren't | If your handler reserves inventory (idempotent) but then emits an event (not guarded), downstream sees duplicate event. |
| No key expiry | Keys accumulate forever, consuming memory. Set expiry (24-72 hours). |
| Treating idempotency as optional for internal services | Even internal APIs and event handlers can be retried. Don't skip protection. |
| Relying on database constraints alone | Unique constraints ensure data dedup but don't prevent side effect duplication (email, charge). |
| One key per operation, not per request | If the same operation is retried, the same key should be used. Different clients/requests get different keys. |

## Cross-references

- **error-strategist**: For designing retry policies, backoff strategies, and error handling; complements idempotency by defining when/how to retry.
- **contract-enforcer**: For designing API contracts; idempotency keys should be documented in your API contract.
