---
name: type-driven-designer
description: Use when primitive types (string, number, boolean) represent domain concepts, when nullable fields have ambiguous meaning, when invalid combinations of fields are structurally possible but logically impossible, or when validation happens far from construction. Trigger on "why is this email field just a string?", "how can status be 'shipped' with no tracking number?", or when reviewing domain model types. NOT for performance-critical inner loops where type wrappers add overhead, dynamic/untyped languages, or API boundary serialization shapes.
---

# Type-Driven Designer

A domain-driven type design framework based on Scott Wlaschin's *Domain Modeling Made Functional* and Yaron Minsky's principle to "make illegal states unrepresentable." The type system is the cheapest enforcement mechanism available. When a function accepts `string` where it means `EmailAddress`, the gap between what the type permits and what the domain allows is where bugs live. Well-designed types make invalid states impossible to construct — not just hard to think about, but structurally impossible.

**Core principle:** The type system should encode business rules so that invalid states are impossible to construct. If you can write code that violates domain rules and the compiler accepts it, your types are doing the wrong work.

## When to Use

- Reviewing domain models and entity types
- When primitive types (string, number, boolean) stand in for domain concepts
- When null fields have ambiguous meaning ("does this missing value mean unknown, not-applicable, or error?")
- When invalid combinations of fields are possible in the type but impossible in the business domain
- When validation happens far from construction, scattered across functions
- When boolean flags hide richer state (isActive, isShipped, isAdmin)
- "Why is this email field just a string?" / "How can status be 'shipped' with no tracking number?"

**Not for:** Performance-critical inner loops where type wrappers add overhead, dynamically-typed languages (the pattern still applies but looks different), API boundary serialization shapes (DTOs crossing network boundaries are constrained by the protocol, not domain rules), or when fighting the language (adding wrappers in a language with no zero-cost abstractions is pragmatically wrong).

## The Process

### 1. Find Primitive Obsession

Look for string, number, and boolean standing in for domain concepts. These are the starting points:

```typescript
// ❌ Primitive obsession
type User = {
  email: string;           // Should be EmailAddress
  age: number;             // Should be Age
  isActive: boolean;       // Should be Status
  isDeleted: boolean;      // Should be Status
  userId: string;          // Should be UserId
  price: number;           // Should be Price with currency
};

// ✅ Domain-driven types
type EmailAddress = string & { readonly __brand: "EmailAddress" };
type Age = number & { readonly __brand: "Age" };
type Status = "active" | "inactive" | "deleted";
type UserId = string & { readonly __brand: "UserId" };
type Price = { amount: number; currency: string };
```

Scan your codebase for patterns like `email: string`, `userId: number`, `isActive: boolean`. Each one is an opportunity to move responsibility from runtime validation to the type system.

### 2. Find Impossible States That Are Representable

Search for contradictory field combinations that shouldn't exist in the type but do:

```typescript
// ❌ Impossible state representable
type Order = {
  status: "draft" | "confirmed" | "shipped" | "delivered";
  trackingNumber?: string;  // But what if status is "draft"? Contradictory.
  paymentMethod?: string;   // But what if status is "shipped"? Payment already made.
  shippingAddress?: string; // But what if status is "draft"? Not needed yet.
};

// This order is valid in TypeScript but invalid in the domain:
const broken: Order = {
  status: "shipped",
  // Missing trackingNumber — impossible in reality
};

// ✅ Discriminated union — states are mutually exclusive
type Order =
  | { status: "draft"; items: LineItem[] }
  | { status: "confirmed"; items: LineItem[]; paymentMethod: string }
  | { status: "shipped"; trackingNumber: string }
  | { status: "delivered"; deliveredAt: Date };
```

Look for nullable fields that create ambiguity:

```typescript
// ❌ What does null mean?
type User = {
  avatar?: string;  // Not uploaded? Deleted? Error? Unknown.
};

// ✅ Explicit union — meaning is clear
type User = {
  avatar: "not_set" | "uploaded" | "removed";
  // or:
  avatar: Avatar;
};

type Avatar =
  | { type: "not_set" }
  | { type: "uploaded"; url: string }
  | { type: "removed"; removedAt: Date };
```

Look for boolean flag explosions:

```typescript
// ❌ Too many flags, unclear combinations
type Subscription = {
  isActive: boolean;
  isCancelled: boolean;
  isPaused: boolean;
  isFreeTrial: boolean;
  // Can isActive and isCancelled both be true? What if isPaused but isActive?
};

// ✅ Union makes valid states explicit
type Subscription =
  | { type: "trial"; expiresAt: Date }
  | { type: "active"; renewsAt: Date }
  | { type: "paused"; pausedAt: Date; resumesAt: Date }
  | { type: "cancelled"; cancelledAt: Date; reason: string };
```

### 3. Apply Fix Patterns

#### Pattern A: Branded / Opaque Types for Validated Values

Brand a type to signal "this string has been validated as an email":

```typescript
type EmailAddress = string & { readonly __brand: "EmailAddress" };

function createEmailAddress(raw: string): EmailAddress | Error {
  if (!raw.includes("@")) return new Error("Invalid email");
  return raw as EmailAddress;
}

function sendEmail(to: EmailAddress, subject: string) {
  // Caller MUST pass EmailAddress, not any string.
  // This prevents invalid emails from being sent.
}

// ❌ This won't compile:
sendEmail("not-an-email", "Hello");

// ✅ This requires validation first:
const email = createEmailAddress("user@example.com");
if (email instanceof Error) {
  console.error(email.message);
} else {
  sendEmail(email, "Hello");
}
```

Use for: email, phone, URLs, currency, order IDs, user IDs — anything that has validation rules.

#### Pattern B: Discriminated Unions for State Machines

Use discriminated unions when an entity moves through states, and each state has different valid fields:

```typescript
type PaymentStatus =
  | { status: "pending"; amount: number; retries: number }
  | { status: "processing"; amount: number; gatewayId: string }
  | { status: "completed"; amount: number; transactionId: string; completedAt: Date }
  | { status: "failed"; amount: number; reason: string; failedAt: Date };

function processPayment(payment: PaymentStatus): PaymentStatus {
  if (payment.status === "pending") {
    // Only pending payments can be processed
    return { status: "processing", amount: payment.amount, gatewayId: "..." };
  }
  // Can't process already-completed or failed payments — type system enforces it
  throw new Error(`Cannot process ${payment.status} payment`);
}
```

Use for: order lifecycle, user states, workflow steps, any entity that moves through distinct states.

#### Pattern C: Eliminate Boolean Flags with Union Variants

Replace boolean flags with explicit union variants:

```typescript
// ❌ Unclear what combinations are valid
type Account = {
  isAdmin: boolean;
  isActive: boolean;
  isSuspended: boolean;
};

// ✅ Explicit roles — can't be both admin and suspended
type Account =
  | { role: "owner"; status: "active" | "suspended" }
  | { role: "admin"; status: "active" | "suspended" }
  | { role: "user"; status: "active" | "suspended" | "inactive" }
  | { role: "guest"; status: "active" };
```

Use for: any combination of booleans that represent a single conceptual choice (role, status, tier).

#### Pattern D: Eliminate Null Ambiguity with Explicit Types

Replace `?:` with explicit union types:

```typescript
// ❌ Does missing = not set, or deleted, or error?
type UserProfile = {
  bio?: string;
  verified?: boolean;
};

// ✅ Meaning is explicit
type UserProfile = {
  bio: Bio;
  verified: VerificationStatus;
};

type Bio =
  | { type: "not_set" }
  | { type: "provided"; content: string }
  | { type: "removed"; removedAt: Date };

type VerificationStatus =
  | { type: "not_verified" }
  | { type: "verified"; verifiedAt: Date }
  | { type: "failed"; reason: string; failedAt: Date };
```

Use for: any optional field that carries more meaning than "present or absent."

### 4. Type Design Report

For each type or field analyzed:

```
TYPE: [type or field name]
  Location:   [file:line]
  Issue:      [primitive obsession / impossible state representable / ambiguous null / boolean flag explosion]
  Evidence:   [specific type definition or parameter]
  Risk:       [what invalid state can be constructed, or what valid states are impossible to express]
  Fix:        [specific type refactoring — branded type, discriminated union, or explicit variant]
```

Example reports:

```
TYPE: Order
  Location:   src/orders/types.ts:12
  Issue:      impossible state representable
  Evidence:   status: "shipped" but trackingNumber is optional
  Risk:       code can call shipOrder() without assigning a tracking number, breaking fulfillment logic downstream
  Fix:        replace with discriminated union — shipped state must have trackingNumber as required field, draft state must not have it

TYPE: User.email
  Location:   src/users/types.ts:5
  Issue:      primitive obsession
  Evidence:   email: string, no validation in type
  Risk:       invalid emails accepted by type system, validation scattered across 8 callsites, test setup doesn't enforce valid emails
  Fix:        create EmailAddress branded type with createEmailAddress() validator, accept EmailAddress in User type

TYPE: Subscription.isActive
  Location:   src/billing/types.ts:23
  Issue:      boolean flag explosion
  Evidence:   isActive, isCancelled, isPaused — unclear which combinations are valid
  Risk:       state machine logic scattered; impossible to reason about valid transitions; tests need to verify all 8 combinations
  Fix:        replace with SubscriptionStatus union variant (trial, active, paused, cancelled), state transitions become explicit

TYPE: User.avatar
  Location:   src/users/types.ts:8
  Issue:      ambiguous null
  Evidence:   avatar?: string
  Risk:       callers can't distinguish "user never uploaded" from "user deleted avatar" — UI can't show correct message
  Fix:        replace with Avatar variant union (not_set | uploaded | removed), each with appropriate data
```

## Interaction Model

Decision engine. When reviewing domain models or entity types, the agent identifies primitive obsession, impossible states, and ambiguous nulls. It produces a type design report with specific recommended refactorings, ordered by risk (impossible states highest, then primitive obsession, then null ambiguity). The agent guides through the fix patterns, showing before/after code. It doesn't redesign entire systems — it focuses on the types that cross module boundaries and carry the most risk.

## Wlaschin & Minsky's Principles (Reference)

1. **Make illegal states unrepresentable.** If a state is invalid in the domain, it should be impossible to construct in the type system. Not "hard to construct," but structurally impossible.
2. **Types are for domain modeling, not just data shapes.** A `User` type should encode what a valid user looks like in your domain, not just "a collection of fields."
3. **Validate at boundaries, trust inside.** Parse/validate incoming data (from users, APIs, databases) into your domain types. Inside your domain, assume types are valid — no defensive checks needed.
4. **Make states explicit.** Replace boolean flags and nullable fields with explicit type variants. Ambiguity in the type leads to bugs in the logic.
5. **Replace flags with types.** Every boolean flag that represents a choice should be a union variant or tagged type instead.

## Guard Rails

**Don't wrap every primitive.** Not every `string` needs to be branded. `firstName: string` is fine — it has no validation rules. But `email: string` where the domain expects a valid email should be `EmailAddress`. Use judgment.

**Types aren't a substitute for runtime validation.** A branded type tells the type system "trust this value," but you still need a validator function at the boundary (parsing user input, loading from database). The type says "I've already validated this," but doesn't do the validation itself.

**Adapt to the language.** TypeScript has discriminated unions and type guards built in. Python uses dataclasses or Pydantic. Rust has enums. Go has interfaces. The pattern is universal; the syntax changes.

**Don't add wrappers with no safety gain.** If wrapping a type adds no validation, no type safety, and no semantic meaning, it's noise. "Why is `UserId` a branded string?" should have a clear answer.

**Balance domain purity with pragmatism.** Serializing domain types to JSON means losing branded types (JSON doesn't preserve types). DTOs at boundaries look different from domain types — that's OK. The domain types are for your logic; DTOs are for crossing boundaries.

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Wrapping primitives without validation | Only brand/wrap types that have validation rules. `firstName: string` is fine; `email: string` that requires `@` should be `EmailAddress`. |
| Creating giant discriminated unions with 15 variants | If your union has that many variants, the entity may be doing too much. Split into multiple types or add a layer of nesting. |
| Using unions for everything | Unions are for mutually exclusive states. If fields aren't related or don't exclude each other, keep them separate. |
| Putting validation in DTOs | DTOs are data shapes for serialization. Validation happens at the boundary, producing domain types. Keep them separate. |
| Fighting the language | If your language doesn't have discriminated unions, use a different pattern (inheritance, interface + concrete classes, builder). Don't force TypeScript patterns into Python. |
| Ignoring "parse, don't validate" | Always validate incoming data into domain types at boundaries. Don't validate deep inside logic. Parser that returns `Result<DomainType>` at the edge; trust inside. |

## Cross-References

→ **contract-enforcer** — Type-driven design encodes contracts in the type system. Use Contract Enforcer to verify those contracts at runtime where needed.

→ **bounded-context-auditor** — Types cross bounded context boundaries. Use this skill to ensure types don't leak across contexts; each bounded context owns its types.

→ **temporal-coupling-detector** — Impossible states often reveal temporal coupling (field A only valid if field B was set first). Discriminated unions eliminate this by making the sequence explicit.
