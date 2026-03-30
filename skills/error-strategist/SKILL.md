---
name: error-strategist
description: Use when writing error handling code, when adding try/catch blocks, when designing how a system responds to failure, or when reviewing code that catches and swallows errors. Trigger on "how should I handle this error?", "what if this fails?", or when the agent's instinct is to wrap something in try/catch. NOT for simple validation of user input (use Contract Enforcer for that).
---

# Error Strategist

A structured error handling framework based on Joe Duffy's *Error Model* (Midori, 2016) and David Abrahams' *Exception Safety Guarantees*. Every error condition has a class (bug, recoverable, fatal) that determines its correct response. Every operation has a safety guarantee (nothrow, strong, basic) that callers can rely on. Error handling without this classification is theater — it looks robust but hides failures.

**Core principle:** Not all errors are the same. A bug should crash. A recoverable error should be surfaced as a typed result. A fatal error should terminate. Code that treats all three the same — catch, log, continue — is converting every failure into silent corruption.

## When to Use

- Writing error handling code (try/catch, error types, result types)
- Designing how a system or feature responds to failure
- Reviewing code that catches and swallows errors
- "How should I handle this error?" / "What if this fails?"
- When the instinct is to add a try/catch
- When error handling exists but errors keep showing up in unexpected places

**Not for:** Input validation at the system boundary (that's the Contract Enforcer's domain — precondition checking). This skill handles what happens *after* valid input enters the system and something still goes wrong.

## The Process

### 1. Classify Every Error Condition

Before writing any error handling, classify the error using Duffy's taxonomy:

**Bug** (programmer mistake)
- Examples: null dereference, index out of bounds, violated invariant, impossible state reached, type assertion failure
- Correct response: **Crash or assert immediately.** Never catch. Never "handle gracefully." The program is in a state its author didn't anticipate — continuing execution is undefined behavior.
- Why: Catching bugs hides them. A caught null dereference becomes a silent wrong result that shows up three layers later as a mysterious data corruption. Crashing immediately surfaces the bug at its origin.
- In production: Use process supervisors, crash recovery, and monitoring. The process restarts clean. This is safer than continuing with corrupted state.

**Recoverable error** (expected operational failure)
- Examples: network timeout, file not found, authentication rejected, rate limited, validation failure, external service unavailable
- Correct response: **Surface to the caller as a typed result.** The caller decides the recovery strategy — retry, fallback, surface to user, queue for later.
- Why: These aren't bugs — they're part of normal operation. The system should handle them explicitly, not treat them as exceptional. The caller has context for recovery that the failing function doesn't.
- Implementation: Use result types (`Result<T, E>`), error unions, or typed exceptions — never string messages or generic error classes.

**Fatal error** (unrecoverable system failure)
- Examples: out of memory, corrupted persistent state, security breach detected, data integrity violation, missing critical configuration at startup
- Correct response: **Terminate the operation or process.** Log everything available. Alert operations. Do not attempt recovery — the system's invariants are broken.
- Why: Attempting to recover from corrupted state risks spreading the corruption. A clean shutdown preserves whatever state is still intact.

**The key test:** Ask "can the caller do something meaningful with this error?"
- Yes → Recoverable. Surface it.
- No, and it's a programmer mistake → Bug. Crash.
- No, and the system's invariants are broken → Fatal. Terminate.

### 2. Assign Exception Safety Guarantee

For each operation that can fail, declare which guarantee it provides. This is a promise to callers about what happens on failure.

**Nothrow guarantee**
- This operation cannot fail. Callers can rely on it unconditionally.
- Applicable to: destructors/cleanup, simple accessors, in-memory computations with bounded inputs, logging (must not fail)
- If something "can't fail" but has a code path that throws, it doesn't have nothrow guarantee. Fix it.

**Strong guarantee**
- If the operation fails, all state rolls back to before the call. As if it never happened.
- Applicable to: database transactions, atomic file writes, state updates that must be all-or-nothing
- Implementation: do all work in a copy or transaction, then swap/commit atomically. If any step fails, discard.

**Basic guarantee**
- If the operation fails, no resources leak and all invariants hold, but state may have partially changed.
- Applicable to: most operations. This is the *minimum acceptable* guarantee.
- If an operation can't even promise basic guarantee (resources might leak, invariants might break), that's a design problem.

**No guarantee** (unacceptable)
- On failure, anything could happen: resources leak, invariants break, state is corrupted.
- This should never exist in production code. If you find it, fixing the guarantee is higher priority than adding features.

### 3. Design the Error Boundary

Error handling doesn't belong at every function. It belongs at **boundaries** where context for recovery exists:

**System boundary** — Where your code meets external systems (network, disk, database, third-party APIs).
- Translate external errors into your domain's error types
- This is where raw `IOException` becomes `StorageUnavailableError`
- External errors should never leak past this boundary in their raw form

**User boundary** — Where errors become user-visible.
- Decide what the user needs to know vs. what's internal
- Format errors for human consumption
- Log the technical details separately

**Transaction boundary** — Where partial failure must be rolled back.
- Define what "rollback" means for this operation
- Implement strong guarantee if business logic requires atomicity

**Between boundaries: propagate, don't catch.**
- A function in the middle of the call stack almost never has enough context to make a recovery decision
- Catching an error just to log and re-throw adds noise without value
- Let errors propagate to the boundary where context for recovery exists

### 4. Error Strategy Report

```
ERROR STRATEGY: [operation or feature]
  Condition:  [what can go wrong — specific failure mode]
  Class:      [bug / recoverable / fatal]
  Guarantee:  [nothrow / strong / basic]
  Boundary:   [where recovery happens — or "propagate"]
  Response:   [specific action: assert, return Result<T, E>, terminate, retry, surface to user]
```

Example:

```
ERROR STRATEGY: Process payment for order
  Condition:  payment gateway returns timeout
  Class:      recoverable — network timeouts are expected operational failures
  Guarantee:  strong — either payment succeeds and order is marked paid, or neither happens
  Boundary:   order service (transaction boundary — payment + order update are atomic)
  Response:   return PaymentResult.TimedOut to caller, caller decides retry/queue/surface

ERROR STRATEGY: Process payment for order
  Condition:  order total is negative
  Class:      bug — this should be impossible given upstream validation
  Guarantee:  n/a — we crash before any state changes
  Boundary:   n/a — assert at point of detection
  Response:   assert(order.total > 0) — if this fires, upstream validation is broken, fix the bug
```

## Interaction Model

Hybrid. The agent classifies errors independently based on code analysis, but asks the human for recovery decisions that are product choices:

- "When the payment fails, should we retry automatically, queue for later processing, or surface the error to the user immediately?"
- "If the external API is down, should the feature degrade gracefully or show an error state?"
- "How long should we retry before giving up? That's a business decision, not a technical one."

Error *classification* is technical. Error *recovery strategy* is often a product decision.

## Anti-Patterns

| Pattern | Problem | Fix |
|---------|---------|-----|
| `catch (Exception e) { log(e); return default; }` | Converts every error into silent corruption. The caller gets a "success" that isn't. | Classify the error. Bugs: let crash. Recoverable: return typed error. Fatal: terminate. |
| `catch (e) { throw new Error("Something went wrong") }` | Destroys the original error's identity and context. Debugging becomes impossible. | Propagate the original error, or wrap it while preserving the cause chain. |
| `try { ... } catch (e) { /* ignore */ }` | The worst pattern. Errors are silently discarded. The system continues in an unknown state. | Remove the catch entirely and let the error propagate, or handle it explicitly. |
| Error handling in every function | Most functions lack context for recovery. Catching everywhere adds noise. | Handle at boundaries only. Let errors propagate through the middle layers. |
| Strings as error types | `throw "user not found"` — callers can't match on error type, can't distinguish error causes. | Use typed errors: `throw new UserNotFoundError(userId)` or return `Result.err(...)`. |
| Retry without idempotency | Retrying a non-idempotent operation (payment charge, email send) can cause duplicate effects. | Verify idempotency before implementing retry. Use idempotency keys where available. |
| Catch-log-rethrow at every layer | `catch (e) { logger.error(e); throw e; }` repeated 5 times means 5 identical log entries. | Log at the boundary where recovery happens, not at every intermediate layer. |

## Guard Rails

**Don't add error handling preemptively.** Handle errors that *can* happen based on the actual code paths, not errors that *might hypothetically* happen. If a function only calls in-memory operations, don't wrap it in try/catch.

**Respect the language's idioms.** In Go, return `(result, error)`. In Rust, return `Result<T, E>`. In TypeScript, use discriminated unions or throw typed errors. Don't fight the language's error model.

**Recovery is a product decision.** The agent can classify errors and design boundaries, but "should we retry?" and "what does the user see?" are product decisions. Ask the human.

**Don't over-specify.** Not every function needs a formal error strategy analysis. A function that calls `JSON.parse` on trusted input doesn't need a three-line error report. Scale to the stakes.

## The Duffy Classification (Reference)

From Joe Duffy's Midori error model:

1. **Bugs are not recoverable at runtime.** They indicate programmer mistakes. The correct response is to fail fast, gather diagnostics, and fix the code. Trying to recover from bugs leads to undefined behavior.

2. **Recoverable errors are expected.** They happen during normal operation. The system should handle them as part of its control flow, not as exceptions to it.

3. **Fatal errors break invariants.** When a system's foundational assumptions are violated, no recovery is meaningful. Terminate cleanly.

4. **The boundary between bug and recoverable depends on context.** A "file not found" error is recoverable if the user might have mistyped a path. It's a bug if the file is a configuration file that was validated at startup and should always exist.

5. **Error handling and normal code should use the same control flow.** Recoverable errors should flow through return values, not through exceptions. Exceptions should be reserved for bugs and fatal conditions that abort the current operation entirely.

## Abrahams' Exception Safety Guarantees (Reference)

| Guarantee | On failure... | Use when... |
|-----------|--------------|-------------|
| **Nothrow** | Cannot fail | Cleanup, accessors, logging |
| **Strong** | Full rollback — state unchanged | Transactions, atomic operations |
| **Basic** | No leaks, invariants hold, state may change | Most operations (minimum bar) |
| **None** | Anything can happen | Never acceptable in production |
