---
name: cqs-auditor
description: Use when functions both mutate state and return values, when calling a "getter" has hidden side effects, when it's unclear whether calling a function is safe to retry or cache, or when testing requires complex setup to verify both return value and state change. Trigger on "is it safe to call this twice?", "why does reading this value change the system?", or when designing read/write boundaries. NOT for stack/queue pop() where mutation+return is inherent, iterator next(), or builder methods that return this.
---

# CQS Auditor

A function design framework based on Bertrand Meyer's *Command-Query Separation* (*Object-Oriented Software Construction*, 1988) and Greg Young's CQRS (Command-Query Responsibility Segregation, 2010). CQS is one of the simplest and most powerful design principles: every function should either be a command (changes state, returns nothing) or a query (returns data, changes nothing) — never both. The principle is so useful that violating it is one of the largest sources of hidden coupling, test complexity, and reasoning bugs.

**Core principle:** Every function should either change state or return data — never both. If a function does both, the effect of calling it is ambiguous: is the return value the reason to call it, or the side effect?

## When to Use

- Reviewing function designs, especially public interfaces
- When functions both mutate state and return values
- When a getter method has hidden side effects (logs, caches, increments counters, notifies subscribers)
- When it's unclear whether calling a function is safe to retry or cache
- When testing requires complex setup to verify both return value and state change
- When functions return data but only the side effect matters, or vice versa
- "Is it safe to call this twice?" / "Why does reading this value change the system?"

**Not for:** Stack/queue `pop()` where mutation and return are inherent to the operation (the exception proves the rule), iterator `next()` (moves cursor and returns value — accepted idiom), or builder methods that return `this` (building pattern, not a data concern).

## The Process

### 1. Classify Every Public Function

For each function, determine whether it's a **query**, **command**, or **mixed violation**:

**Query** (safe, side-effect free)
- Returns data
- Does NOT change any observable state
- Safe to call multiple times with the same effect
- Safe to cache
- Can be called in any order
- Example: `getUser(id)`, `calculateTotal(items)`, `isEligible(user)`

```typescript
// ✅ Query — can call as many times as needed
function getUserById(id: string): User {
  return database.find(id);
}

// ✅ Query — pure calculation
function calculateDiscount(price: number, tier: string): number {
  return tier === "premium" ? price * 0.9 : price;
}
```

**Command** (intentional side effect, returns void)
- Changes observable state
- Returns `void` (nothing)
- Called for its side effect, not its return value
- May not be safe to retry (depends on idempotence)
- Example: `deleteUser(id)`, `incrementCounter()`, `sendEmail(to, subject)`

```typescript
// ✅ Command — changes state, returns nothing
function createUser(data: UserData): void {
  database.insert(data);
  eventBus.emit("user.created", { id: data.email });
}

// ✅ Command — explicit void
function logMetric(name: string, value: number): void {
  logger.record(name, value);
}
```

**Mixed** (violation — has both)
- Changes observable state AND returns data
- Unsafe to retry (second call will have different effect)
- Unsafe to cache (what changes between calls?)
- Testing must verify both aspects, making tests complex
- Examples: `getOrCreateUser(email)`, `popFromStack()`, `processAndReturn()`

```typescript
// ❌ Mixed — mutation + return (violation)
function getOrCreateUser(email: string): User {
  let user = database.find(email);
  if (!user) {
    user = { email, createdAt: now() };
    database.insert(user);  // ← mutation
    eventBus.emit("user.created", user);
  }
  return user;  // ← return
}

// ❌ Mixed — query with hidden side effect
function getBalance(accountId: string): number {
  const balance = database.getBalance(accountId);
  logger.record("balance.accessed", { accountId, balance });  // ← hidden mutation
  cache.set(accountId, balance);  // ← hidden mutation
  return balance;
}
```

### 2. Detect Violations

Mark functions as violations if they:

- **Return a value AND mutate state** — the caller can't tell if they're calling for the return or the effect
- **Hide mutations in getters** — a function named `getValue()` shouldn't call `emit()` or `increment()` or `write to cache`
- **Return error codes instead of throwing** — if the return type is carrying both data and error signal (a code smell of mixed concern)
- **Accumulate side effects scattered across the call** — side effect happens in database, side effect in cache, side effect in event bus, all in one function

### 3. Classify Violation Severity

Not all violations are equally bad. Rank them:

**Concealed query** (most dangerous)
- Function looks like a getter (named `get*()`, `fetch*()`, `compute*()`)
- Caller expects only a return value, no side effects
- But the function has hidden mutations (logs, caches, increments, notifies)
- Risk: caller calls it in loops, caches the result, or calls it twice expecting no effect — all wrong
- Example: `getNextSequenceId()` increments the database counter

```typescript
// ❌ Concealed query — looks like a getter, has a side effect
function getNextOrderId(): string {
  const id = database.incrementAndFetch("order_seq");  // ← hidden mutation
  return id;
}

// Caller writes this, thinking it's safe to cache:
const id1 = getNextOrderId();
const id2 = getNextOrderId();
// But now id1 === id2 is false, defeating caching
```

**Bundled command-query** (explicitly clear, less hidden but still risky)
- Function name signals it does both (e.g., `createAndReturn()`, `getOrCreate()`, `popAndLog()`)
- Caller knows it does both, but testing and reasoning are complex
- Risk: harder to retry safely, testing requires mocking both state and return value
- Example: `getOrCreateUser(email)`

```typescript
// ⚠️ Bundled command-query — explicit but mixed responsibility
function getOrCreateUser(email: string): User | null {
  let user = database.find(email);
  if (!user) {
    user = database.create({ email });  // ← mutation
  }
  return user;  // ← return (different on second call!)
}

// Caller must know: first call creates, subsequent calls just return.
// Testing must verify both paths.
```

**Incidental side effect** (judgment call)
- Function's primary purpose is clear (query or command)
- But it has a small incidental side effect (logging, metrics, audit trail)
- Risk: medium — logging shouldn't affect correctness, but it complicates testing
- Example: `getUser(id)` that logs access for metrics

```typescript
// ⚠️ Incidental side effect — mostly a query, but logs
function getUser(id: string): User {
  const user = database.find(id);
  metrics.increment("user.fetched");  // ← incidental side effect
  return user;
}

// Acceptable in most domains, but test setup is more complex:
// Must configure metrics mock, verify both the return and that metrics.increment was called
```

### 4. Apply the Separation

For each violation, extract it into separate query and command functions:

#### Example 1: Concealed Query

**Before:**
```typescript
// ❌ Concealed query — looks safe, has hidden side effect
function getNextOrderId(): string {
  const id = database.incrementAndFetch("order_seq");
  return id;
}

// Caller thinks it's safe to cache:
const id = getNextOrderId();  // Returns "ORD001"
const id2 = getNextOrderId(); // Caller expects same? Nope, now "ORD002"
```

**After:**
```typescript
// ✅ Explicit command — allocation changes state
function allocateNextOrderId(): string {
  return database.incrementAndFetch("order_seq");
}

// ✅ Explicit query — side-effect free
function getLatestOrderId(): string {
  return database.getLatest("order_seq");
}

// Caller must think about which one:
const id = allocateNextOrderId();  // Reserves a number
const latest = getLatestOrderId(); // Just reads
```

#### Example 2: Bundled Command-Query

**Before:**
```typescript
// ⚠️ Mixed — returns user, also creates if missing
function getOrCreateUser(email: string): User {
  let user = database.findByEmail(email);
  if (!user) {
    user = { email, id: generateId(), createdAt: now() };
    database.insert(user);
    eventBus.emit("user.created", { email });
  }
  return user;
}

// Caller:
const user = getOrCreateUser("alice@example.com");
// Is alice new or existing? Function doesn't say.
// Testing: must mock database.insert, eventBus.emit, and verify return.
```

**After:**
```typescript
// ✅ Query — fetch existing
function getUserByEmail(email: string): User | null {
  return database.findByEmail(email);
}

// ✅ Command — create new (returns void — pure command)
function createUser(email: string): void {
  const user = { email, id: generateId(), createdAt: now() };
  database.insert(user);
  eventBus.emit("user.created", { email });
}

// Caller — command then query:
let user = getUserByEmail("alice@example.com");
if (!user) {
  createUser("alice@example.com");
  user = getUserByEmail("alice@example.com")!;
}

// Or with a single operation at a higher level:
function ensureUserExists(email: string): { user: User; isNew: boolean } {
  let user = getUserByEmail(email);
  if (user) {
    return { user, isNew: false };
  }
  user = createUser(email);
  return { user, isNew: true };
}
```

Notice: `ensureUserExists` is still mixed, but it's **honest** about it. The name says both, and the return type makes both explicit (`{ user, isNew }`). The caller can decide to call it or split the query/create, and testing can verify both aspects clearly.

### 5. CQS Report

For each violation found:

```
CQS: [function name]
  Location:   [file:line]
  Type:       [concealed query / bundled command-query / incidental side effect]
  Mutation:   [what state changes]
  Return:     [what it returns]
  Risk:       [caching implications / retry implications / testing complexity]
  Fix:        [specific split into query + command, or rename to be honest]
```

Example 1: Concealed Query

```
CQS: getNextOrderId
  Location:   src/orders/service.ts:42
  Type:       concealed query
  Mutation:   database sequence "order_seq" incremented
  Return:     next sequence ID (string)
  Risk:       caller caches result thinking it's side-effect-free; second call gets different ID; caching breaks
  Fix:        rename to allocateNextOrderId() to signal mutation, or split into allocateId() (command) + getLatestId() (query)
```

Example 2: Bundled Command-Query

```
CQS: getOrCreateUser
  Location:   src/users/service.ts:18
  Type:       bundled command-query
  Mutation:   database insert (if user doesn't exist), eventBus.emit("user.created")
  Return:     User object (existing or newly created)
  Risk:       testing must verify both database state and return value; retry semantics unclear (idempotent on read, not on create)
  Fix:        split into getUserByEmail(email): User | null (query) and createUser(email): User (command); caller composes them
```

Example 3: Incidental Side Effect

```
CQS: getUser
  Location:   src/users/service.ts:8
  Type:       incidental side effect
  Mutation:   metrics.record("user.fetched", { id, duration })
  Return:     User object
  Risk:       test must mock metrics, adds setup complexity, but doesn't affect correctness
  Fix:        acceptable in domain layer; if unacceptable, move metrics to caller or extract into a decorator
```

## Interaction Model

Decision engine. When reviewing code, the agent classifies functions as queries, commands, or mixed. It prioritizes concealed queries (most dangerous), then bundled command-queries, then incidental side effects. For each violation, it recommends a specific split or honest renaming. It provides before/after examples showing how to separate the concerns. It doesn't refactor entire codebases — it focuses on public interfaces and functions that cross module boundaries.

## CQS at System Level: CQRS

Meyer's CQS is a function-level principle. At the system level, this same thinking leads to **CQRS** (Command-Query Responsibility Segregation): separate read and write models.

In CQRS:
- **Command side** — accepts commands, updates the write model (authoritative state)
- **Query side** — reads the read model (denormalized, optimized for queries)
- Event stream or sync mechanism — propagates changes from write model to read model

CQRS is useful at architectural scale (multiple services, expensive infrastructure), but it's not required. A single codebase can follow CQS at the function level without CQRS at the system level. This skill focuses on **function-level CQS**. When you have CQS at the function level, CQRS at the system level becomes easier to introduce if needed.

## Meyer's CQS Principles (Reference)

1. **Every query must return a value and not change observable state.** Getters should get; they should not have side effects.
2. **Every command must change state and return `void`.** Mutators should mutate; they should not return data.
3. **No function should do both.** The ambiguity of "am I calling this for the value or the effect?" is dangerous.
4. **CQS enables reasoning and testing.** Pure queries can be called in any order, cached, or skipped. Commands are intentional, explicit, and testable.
5. **`pop()` is the exception.** Stack/queue pop is a classic exception because the data and the state change are inseparable. Acknowledge exceptions, don't generalize from them.

## Guard Rails

**Public interface only.** CQS matters most at public boundaries. Private helper functions are less critical — a private function that does both is lower risk than a public API that does.

**The `pop()` exception.** Stack, queue, and iterator operations are traditional exceptions where mutation + return is inherent. These are accepted idioms in most languages. Don't apply CQS dogmatically.

**Function CQS ≠ System CQRS.** CQS is about individual functions. CQRS is about system architecture. You can do CQS without CQRS. You shouldn't do CQRS without CQS at the function level.

**Logging is acceptable.** A query that logs its access is mostly CQS-compliant. Logging for observability and metrics is often considered incidental, not a violation. But be intentional: log at the boundary, not deep in queries.

**Not every return makes a function a query.** A command can return an error code or status (though exceptions are cleaner). The question is: does the function change observable state? If yes, it's a command, even if it returns something.

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Naming mixed functions as getters | If a function mutates, don't name it `get*`. Call it `allocate*`, `fetch*AndCache`, or `createOrGet*` — signal the mutation. |
| Splitting but sharing mutable state | Splitting `getOrCreateUser` into `getUser` + `createUser` is good. But if both functions mutate a shared cache, you've only moved the problem. Ensure each function's mutations are isolated. |
| Applying CQS to every private method | Focus on public boundaries. Private helpers can be more pragmatic. |
| Treating CQRS as a prerequisite for CQS | CQRS is an architectural pattern for large systems. CQS is a function-level principle. Apply CQS first; CQRS only if your system needs it. |
| Ignoring concealed queries | A function named `getBalance()` that increments a counter is a bug waiting to happen. Concealed queries are the most dangerous violation. |
| Returning void from commands that fail | If a command can fail, return an error code or throw an exception. Don't return `void` and hide the failure in a side effect (writing to a log that no one checks). |

## Cross-References

→ **idempotency-guardian** — CQS enables idempotent commands. Use Idempotency Guardian to ensure that commands can be safely retried.

→ **contract-enforcer** — CQS is a contract: queries change nothing, commands return void. Use Contract Enforcer to verify these contracts at runtime if needed.

→ **composability-auditor** — Separated queries and commands compose better. Pure queries can be combined; explicit commands are testable. Use this skill to check if functions are composable.
