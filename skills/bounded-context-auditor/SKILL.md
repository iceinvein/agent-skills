---
name: bounded-context-auditor
description: Use when the same domain term means different things in different parts of the codebase, when a God Model has grown to serve multiple subsystems with conflicting needs, when teams step on each other modifying shared domain objects, or when deciding where service/module boundaries should be. Trigger on "should this be one service or two?", "why does the User class have 40 fields?", or when a change to one feature breaks an unrelated feature through a shared model. NOT for code-level coupling within a single context, import direction problems, or event payload design within a known context.
---

# Bounded Context Auditor

A strategic design analysis framework based on Eric Evans' *Domain-Driven Design* (2003) and the concept of bounded contexts. Most expensive architectural mistakes happen when boundaries are drawn wrong — forcing a single model to serve masters with conflicting needs, creating false unified domains where multiple distinct domains actually exist, and preventing teams from evolving features independently. Bounded contexts are linguistic and model boundaries, not technology decisions. Within a bounded context, every term has exactly one meaning and every model serves exactly one purpose. When the same word means different things, those are separate bounded contexts that must be explicitly separated, with intentional integration patterns between them.

**Core principle:** A bounded context is a linguistic and model boundary. Within it, every domain term has exactly one meaning. When the same word means different things in different parts of the system — Order in sales vs. fulfillment, User in auth vs. commerce vs. billing — those are separate bounded contexts that must be explicitly separated and integrated through clear translation zones.

## When to Use

- The same domain term means different things in different parts of the codebase
- A God Model has grown to serve multiple subsystems with conflicting needs
- Teams keep stepping on each other, modifying shared domain objects and breaking changes
- Deciding where service or module boundaries should be drawn
- Questions like "should this be one service or two?" or "why does User have 40 fields?"
- A change to one feature breaks an unrelated feature through a shared model
- Analyzing why a model evolved to serve incompatible purposes

**Not for:** Coupling within a single bounded context (use coupling-auditor for intra-context coupling), import direction or module structure problems (use dependency-direction-auditor), or event payload design within a known context (use event-design-reviewer for that).

## The Process

### 1. Listen for Linguistic Fractures

Language is the first signal that boundaries exist. Look for three patterns:

**Polysemous terms** (same word, different meanings)
- Order means one thing in the Sales context (commitment to deliver, with pricing rules) and something different in Fulfillment (physical shipment, with warehouse locations)
- User means one thing in Auth (identity, password, MFA) and something else in Billing (account holder, payment method, invoice address)
- Payment means one thing in the Shopping context (checkout decision) and something else in Finance (cash flow, reconciliation)
- These are separate bounded contexts that happen to use the same English word

**Contested models** (single type serving multiple masters)
- A User class with 40 fields because it needs to be a principal for authentication, a contract holder for commerce, a party in disputes, and a billing entity
- An Order object that needs fields for sales (discount codes, sales rep), fulfillment (warehouse location, picking priority), and accounting (tax jurisdiction, revenue recognition date)
- A Product that means raw item in Inventory but includes pricing tiers in Commerce and compliance metadata in Regulatory
- Red flag: model size grows whenever a new subsystem touches it, and fields are unused by some contexts

**Translation zones** (mapper functions between representations)
- A `convertOrderToShipment()` function suggests Order and Shipment are separate contexts with the same domain concept in different languages
- An `adaptPaymentResponseToLedgerEntry()` function suggests Payment and Ledger contexts have different languages for related concepts
- These mappers are often named ad-hoc and scattered; their presence suggests unmapped context boundaries

### 2. Draw the Context Map

For each distinct bounded context discovered, document its position in the system using Evans' relationship types:

**Shared Kernel**
- Two contexts own the same model together; changes require coordination
- Example: Billing and Invoicing both own an Invoice model; neither context can change it unilaterally
- Risk: coordination overhead, slow feature velocity, shared stability risk
- Use only when tight coupling is genuinely necessary (rare)

**Customer-Supplier**
- Upstream context accommodates downstream needs
- Example: Shipping (upstream) provides tracking APIs that Commerce (downstream) needs
- Relationship is clear: downstream is the customer, upstream is the supplier
- Upstream prioritizes not breaking downstream; downstream trusts upstream's contract

**Conformist**
- Downstream uses upstream's model as-is, no translation
- Example: Reports context uses raw Order from Sales context without mapping
- Risk: if upstream changes its model, downstream breaks; no translation buffer
- Acceptable when upstream is genuinely stable (e.g., a published service owned by another team)

**Anti-Corruption Layer (ACL)**
- Downstream translates upstream's model to its own language
- Example: Fulfillment receives Order from Sales but translates to internal ShippableItem; changes to Order don't touch Fulfillment
- Goal: isolation. Downstream only knows upstream's public interface, not internals
- Bidirectional data flow, but translation is one-way

**Open Host Service**
- Upstream publishes a protocol/API specifically for downstreams
- Example: Payment Gateway publishes a stable API contract that all consumers depend on
- Upside: clear contract, versioning, planned deprecation
- Downside: upstream must maintain backward compatibility

**Separate Ways**
- No integration between contexts; they genuinely don't interact
- Example: Marketing analytics and Warehouse inventory have no integration
- Acceptable when contexts truly don't share data or workflows

### 3. Identify Context Violations

For each violation found, classify it by type and document its impact:

**Leaking language** (terminology from one context bleeding into another)
- Billing context code contains `order_status` field (Sales terminology)
- Fulfillment context references `invoice_number` (Accounting terminology)
- Fix: Use context-native terminology. Fulfillment should track shipment_id, not order_status.

Example violation block:
```
LEAKING LANGUAGE: Auth context leaking into Commerce
  Violation:  Commerce.User has `mfa_enabled`, `last_login`, `session_ttl` fields
  Impact:     Commerce logic shouldn't care about Auth internals; Auth changes force Commerce recompilation
  Boundary:   Auth owns User identity; Commerce owns Customer (account holder)
  Fix:        Extract Auth.Principal (public API), map to Commerce.Customer in ACL
```

**Shared model pollution** (single type serving multiple incompatible masters)
- User class serves Auth (needs password hash, MFA), Commerce (needs billing address, tax ID), and Disputes (needs communication preferences)
- Order class serves Sales (needs discount rules, sales rep assignment), Fulfillment (needs warehouse location, picking priority), and Accounting (needs tax jurisdiction, revenue date)
- Problem: One team's change breaks another's logic; model grows indefinitely
- Fix: Each context owns its model; integration uses ACL

Example violation block:
```
SHARED MODEL POLLUTION: User serving three incompatible masters
  Model:      User (auth, commerce, disputes)
  Auth uses:  password_hash, mfa_enabled, last_login, session_ttl (25 fields)
  Commerce uses: billing_address, tax_id, payment_method, preferred_currency (20 fields)
  Disputes uses: communication_preferences, escalation_contact (5 fields, unused by others)
  Conflicts:  Auth's session_ttl is meaningless in Commerce; Disputes' escalation_contact unused elsewhere
  Fix:        Auth owns Principal; Commerce owns Customer; Disputes owns Party. All map through ACLs.
```

**Missing Anti-Corruption Layer** (downstream directly uses upstream's raw model)
- Fulfillment directly reads Order object from Sales without mapping
- Risk: Order changes require Fulfillment recompilation and testing
- Fix: Create Fulfillment's ShippableItem model, translate Order → ShippableItem in ACL

Example violation block:
```
MISSING ACL: Fulfillment directly depends on Sales.Order
  Upstream:   Sales.Order (fields: id, customer, items, total, discount_percentage, sales_rep_id)
  Downstream: Fulfillment receives Order, extracts items and calculates weight (uses only items)
  Risk:       If Sales adds `discount_percentage` calculation or renames `items` to `line_items`, Fulfillment breaks
  Fix:        Create Fulfillment.ShippableItem { order_id, items, total_weight }, map in Sales→Fulfillment ACL
```

### 4. Context Map Report Format

For each bounded context and relationship:

```
CONTEXT: [name]
  Language:      [core terms and their meanings specific to this context]
  Core models:   [primary types this context owns]
  Boundary:      [directory or service name]
  Team:          [owning team]

RELATIONSHIP: [A] → [B]
  Type:          [Shared Kernel / Customer-Supplier / Conformist / ACL / Open Host Service / Separate Ways]
  Integration:   [how they communicate: sync API, events, mapped objects, etc.]
  Health:        [clean / leaking language / shared model pollution / missing ACL / tangled]
  Fix:           [specific action if unhealthy]
```

Example map:

```
CONTEXT: Sales
  Language:      Order (commitment to customer), Customer (buyer), LineItem (promised product)
  Core models:   Order, Customer, LineItem, Discount, SalesRep
  Boundary:      src/sales/
  Team:          @sales-squad

CONTEXT: Fulfillment
  Language:      Shipment (physical delivery), Item (fulfillable SKU), Warehouse (shipping point)
  Core models:   Shipment, ShippableItem, Warehouse, TrackingEvent
  Boundary:      src/fulfillment/
  Team:          @logistics-squad

RELATIONSHIP: Sales → Fulfillment
  Type:          Customer-Supplier (Fulfillment is downstream customer, Sales is supplier)
  Integration:   Sales publishes OrderCreated event; Fulfillment translates to ShippableItem
  Health:        leaking — Fulfillment code contains `order_status` and `discount_percentage`
  Fix:           Create Fulfillment.ShippableItem model, build ACL in fulfillment/adapters/sales-translator.ts
```

## Interaction Model

Hybrid. For greenfield design, the skill is interview-driven — asks about domain terminology, team boundaries, and which features tend to change together. For existing codebases, the skill is decision engine — scans for polysemous terms (same word used in different modules), oversized models (classes growing to serve multiple masters), and translation zones that signal unmapped boundaries. The agent synthesizes findings into a context map and prioritizes violations by team friction (shared kernel and leaking language cause the most friction).

## Evans' Strategic DDD Patterns (Reference)

1. **Ubiquitous language is the foundation.** Every term in a bounded context has exactly one meaning. If a term means multiple things, there are multiple contexts.
2. **Bounded context is a linguistic and model boundary.** It's not a technology choice (microservice vs. module), it's a domain choice. Multiple bounded contexts can live in one service; one context can span services.
3. **Context map is the glue.** The map shows how contexts relate and integrates them explicitly. Without a map, contexts bump into each other implicitly and break.
4. **Anti-Corruption Layer protects the downstream.** If you're integrating with an external system, don't let its model leak into yours. Translate it.
5. **Shared kernel is the most expensive relationship.** Don't default to it. Use it only when genuine shared ownership is necessary; otherwise, separate and integrate.

## Guard Rails

**Don't split what doesn't need splitting.** Some coupling is inherent. If two features genuinely share a concept and always change together, they may belong in the same context. Boundaries should reflect domain truth, not anticipate future uncertainty.

**Contexts are about language, not technology.** The decision to split isn't "should this be a microservice?" but "do these teams use different language for this concept?" You can have multiple contexts in one service (with clear package boundaries) or one context across multiple services (unusual but possible).

**Ubiquitous language is non-negotiable.** If you can't agree on what a term means, you don't have a bounded context yet. Use language disagreement as a signal that contexts need to be split.

**Don't default to Shared Kernel.** Shared kernel is the tightest relationship and creates coordination overhead. Separate and use Anti-Corruption Layer instead. Shared kernel should be rare.

**Context maps evolve.** Your first map may be wrong. As the system grows, previously unified contexts may need to split, or previously separate contexts may need tighter integration. Revisit the map as the domain evolves.

**Don't confuse subdomains with bounded contexts.** A subdomain is a partition of the problem domain (e.g., Shipping is a subdomain of E-commerce). A bounded context is a linguistic boundary. One subdomain may need multiple contexts, or one context may span multiple subdomains.

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| One model to rule them all | Each bounded context owns its models. Contexts integrate through explicit translation (ACL), not shared models. Split the model by context. |
| Boundaries by technical layer | Contexts are linguistic, not technical. Don't boundary by "database layer" or "API layer." Boundary where language changes. |
| Sharing database tables between contexts | Each context should own its data. If contexts share tables, they're not actually separate. Use ACL for data translation, not shared schema. |
| Passthrough Anti-Corruption Layer | An ACL should translate, not pass through unchanged. If your mapper just copies fields 1:1, you haven't separated contexts. The translation should change shape/language. |
| Skipping the context map | Without documenting relationships, contexts collide silently. The map is as important as the code. Keep it updated. |
| Every microservice = own context | A service can have multiple contexts (with clear boundaries), or one context can span services. Technology is not the boundary. |
| Ignoring polysemous terms | When the same word means different things, stop and ask: are these really separate contexts? Usually yes. Separate them. |
| Leaking upstream terminology downstream | Conformist and ACL are different. Conformist means you accept upstream's language. ACL means you translate to your own. Choose deliberately. |

## Cross-references

- **coupling-auditor**: For analyzing how modules communicate within a bounded context; not for inter-context relationships (that's this skill).
- **event-design-reviewer**: For designing event contracts within a context, or for event structure between contexts; assumes contexts are already known.
- **module-secret-auditor**: For finding what's hidden inside a module; complements bounded context analysis by revealing what should be context boundaries but is currently internal.
