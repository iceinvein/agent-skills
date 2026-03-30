---
name: integration-pattern-auditor
description: Use when designing or reviewing how components, services, or modules communicate through messages, events, queues, or APIs. Trigger on "how should these services talk to each other?", "should this be async?", "why are messages being lost?", or when reviewing event-driven architecture, pub/sub systems, or inter-service communication. NOT for in-process function calls with no messaging involved.
---

# Integration Pattern Auditor

A messaging architecture framework based on Gregor Hohpe & Bobby Woolf's *Enterprise Integration Patterns* (2003). Every inter-component communication has a pattern — channel, router, transformer, endpoint — and choosing the wrong pattern creates silent failures, lost messages, and accidental coupling. This skill forces the agent to name the pattern, evaluate whether it fits, and identify missing infrastructure (dead letter queues, idempotency, delivery guarantees).

**Core principle:** Messaging is not just "send and hope." Every message has a channel, a routing strategy, a transformation pipeline, and endpoint contracts. If you can't name the pattern, you're building ad-hoc infrastructure that will fail in ways you haven't anticipated.

## When to Use

- Designing how components, services, or modules communicate
- Choosing between sync and async communication
- Building or reviewing event-driven architecture
- "How should these services talk to each other?"
- "Should this be async?" / "Why are messages being lost?"
- Reviewing pub/sub systems, message queues, or event buses
- When a service integration "mostly works" but sometimes loses data

**Not for:** In-process function calls with no messaging layer, database schema design, UI component communication within a single rendering framework (use Unidirectional Flow Enforcer for that).

## The Process

### 1. Identify the Communication Pattern

For each inter-component communication, classify it using Hohpe & Woolf's pattern categories:

**Messaging Channels — How messages travel**

| Pattern | When to use | When NOT to use |
|---------|-------------|-----------------|
| **Point-to-Point** | Exactly one consumer must process each message (task distribution) | Multiple consumers need the same event |
| **Publish-Subscribe** | Multiple consumers need to react to the same event independently | Only one consumer exists (use point-to-point — simpler) |
| **Dead Letter Channel** | Messages that can't be processed must not be silently dropped | You can genuinely afford to lose messages (rare) |
| **Invalid Message Channel** | Messages that fail validation need separate handling | All messages are guaranteed valid (almost never true) |

**Message Routing — How messages find their destination**

| Pattern | When to use | When NOT to use |
|---------|-------------|-----------------|
| **Content-Based Router** | Destination depends on message content (order type → different handlers) | Fixed routing (all messages go to same place) |
| **Message Filter** | Only some messages are relevant to a consumer | All messages are relevant |
| **Splitter** | A single message contains multiple items that need independent processing | The message is atomic and should be processed as one unit |
| **Aggregator** | Multiple related messages must be combined before processing | Messages are independent |
| **Scatter-Gather** | You need responses from multiple services, combined into one result | A single service can answer the request |

**Message Transformation — How messages change shape**

| Pattern | When to use | When NOT to use |
|---------|-------------|-----------------|
| **Envelope Wrapper** | Message needs metadata (routing, auth, correlation) without modifying the payload | Payload and metadata are inseparable |
| **Content Enricher** | Message lacks data the consumer needs — enrich from another source | The producer can include all needed data |
| **Content Filter** | Message contains more data than the consumer needs | Consumer needs the full payload |
| **Canonical Data Model** | Multiple producers/consumers need a shared schema | Only two components communicate (not worth the indirection) |

**Message Endpoints — How components connect to channels**

| Pattern | When to use | When NOT to use |
|---------|-------------|-----------------|
| **Polling Consumer** | Consumer controls when to process (batch, scheduled) | Real-time processing needed |
| **Event-Driven Consumer** | Messages should be processed as they arrive | Consumer needs to control timing |
| **Competing Consumers** | Multiple instances of a consumer process from the same queue for throughput | Message ordering must be preserved (competing consumers break ordering) |
| **Idempotent Receiver** | Messages may be delivered more than once (always assume this) | You have a formal exactly-once delivery guarantee (you almost certainly don't) |

### 2. Check for Missing Infrastructure

For every messaging integration, verify these are present:

**Delivery guarantees — What happens when delivery fails?**
- Is the delivery guarantee explicit? (at-most-once, at-least-once, exactly-once)
- If at-least-once: is the consumer idempotent? (Can it process the same message twice without side effects?)
- If at-most-once: is message loss acceptable for this use case?
- "Exactly-once" across network boundaries is almost always a lie. If you think you have it, verify.

**Dead letter handling — What happens to unprocessable messages?**
- Do unprocessable messages go to a dead letter queue, or are they silently dropped?
- Is there alerting on the dead letter queue?
- Is there a process for inspecting and reprocessing dead letters?

**Ordering — Does order matter?**
- If message order matters, is it preserved? (Competing consumers and most pub/sub systems break ordering.)
- If order doesn't matter, are consumers written to handle out-of-order delivery?

**Backpressure — What happens when the consumer can't keep up?**
- Does the system handle slow consumers? (Buffering, dropping, backpressure signal)
- Can a slow consumer cause the producer to block or OOM?

**Poison messages — What happens to messages that always fail?**
- Is there a retry limit? (Without one, a poison message blocks the queue forever.)
- After max retries, does the message go to dead letter or get dropped?

### 3. Evaluate Sync vs. Async

For each communication point, evaluate whether synchronous or asynchronous is appropriate:

**Use synchronous (request-response) when:**
- The caller needs the result before proceeding
- The operation is fast and the callee is reliable
- Failure should immediately fail the caller

**Use asynchronous (messaging) when:**
- The caller doesn't need the result immediately
- The operation is slow, unreliable, or involves external systems
- Multiple consumers need to react to the same event
- The system needs to survive temporary consumer failures
- You want to decouple producer and consumer deployment/scaling

**Red flag:** Synchronous calls to unreliable external services without timeout, retry, or circuit breaker. This is the #1 integration failure pattern.

### 4. Integration Pattern Report

```
INTEGRATION: [component A] → [component B]
  Pattern:     [named pattern from Hohpe & Woolf]
  Channel:     [point-to-point / pub-sub / request-reply]
  Delivery:    [at-most-once / at-least-once / exactly-once (verify!)]
  Idempotent:  [yes / no / not applicable]
  Dead letter:  [present / missing — risk of silent message loss]
  Ordering:    [preserved / not preserved / not required]
  Sync/Async:  [sync / async — with justification]
  Missing:     [specific infrastructure gaps]
```

Example:

```
INTEGRATION: OrderService → PaymentService (charge customer)
  Pattern:     Request-Reply over message queue (async request-response)
  Channel:     point-to-point — exactly one payment processor per order
  Delivery:    at-least-once (RabbitMQ with publisher confirms)
  Idempotent:  YES — PaymentService uses order ID as idempotency key
  Dead letter:  present — failed charges go to payment-dlq, alerting configured
  Ordering:    not required — payments are independent
  Sync/Async:  async — payment processing is slow (2-5s) and PaymentService may be temporarily unavailable
  Missing:     no circuit breaker on OrderService side — if PaymentService is down, OrderService will fill the queue unboundedly
```

## Interaction Model

Decision engine with Socratic hook. The agent analyzes messaging architecture independently but asks the human for context it can't derive from code:

- "If this message is delivered twice, would that cause a duplicate charge / duplicate email / duplicate record?"
- "Can the consumer tolerate being unavailable for minutes? Hours?"
- "Does the order these events are processed in matter for correctness?"

Delivery requirements are business decisions. The pattern analysis is technical.

## Anti-Patterns

| Pattern | Problem |
|---------|---------|
| Fire-and-forget with no dead letter queue | Messages that fail processing are silently lost |
| Synchronous HTTP to an unreliable service with no timeout | Caller hangs indefinitely when callee is slow/down |
| "Exactly-once delivery" across network boundaries | Almost always a false guarantee — design for at-least-once + idempotency |
| Pub/sub where only one consumer exists | Unnecessary complexity — use point-to-point |
| Competing consumers where ordering matters | Consumers process messages out of order, breaking correctness |
| Consumer that crashes and loses the message | Acknowledge after processing, not before |
| No backpressure on an unbounded queue | Producer fills memory/disk when consumer is slow |
| Retry loop with no max retries | Poison message blocks the queue forever |
| Different message formats between producer and consumer with no schema contract | Serialization failures at runtime — invisible until production |

## Guard Rails

**Don't over-engineer simple communication.** If two components are in the same process and a function call works, a function call is the right pattern. Messaging adds latency, complexity, and failure modes. It earns its place when you need decoupling, durability, or fan-out.

**Name the pattern before building.** If you can't name the Hohpe & Woolf pattern you're implementing, you're building custom infrastructure. Custom infrastructure has custom failure modes that nobody else has debugged.

**Assume at-least-once delivery.** Unless you have a formal proof of exactly-once (you don't), design every consumer to be idempotent. This is the single most important rule in messaging architecture.

**Dead letter queues are not optional.** Every message queue needs a dead letter destination. "We'll add it later" means "messages will be silently lost in production."

## The Hohpe & Woolf Pattern Categories (Reference)

1. **Messaging Channels** — Point-to-Point, Pub/Sub, Datatype, Dead Letter, Invalid Message, Guaranteed Delivery
2. **Message Construction** — Command, Document, Event, Request-Reply, Return Address, Correlation ID
3. **Message Routing** — Content-Based Router, Message Filter, Recipient List, Splitter, Aggregator, Resequencer, Scatter-Gather
4. **Message Transformation** — Envelope Wrapper, Content Enricher, Content Filter, Claim Check, Normalizer, Canonical Data Model
5. **Message Endpoints** — Polling Consumer, Event-Driven Consumer, Competing Consumers, Message Dispatcher, Selective Consumer, Idempotent Receiver, Transactional Client
6. **System Management** — Control Bus, Detour, Wire Tap, Message History, Message Store, Smart Proxy, Test Message

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Treating all communication as "just HTTP calls" | Classify each interaction by pattern. HTTP is one transport, not one pattern. |
| Building a message bus for two services | Point-to-point or direct calls are simpler when you have few participants. |
| No correlation ID across async flows | Add correlation IDs from the start. Debugging async flows without them is nearly impossible. |
| Consumer processes message, then acknowledges | Acknowledge AFTER processing. If the consumer crashes between ack and processing, the message is lost. |
| Assuming message order is preserved | Most distributed queues don't guarantee ordering. Verify or design for out-of-order. |
