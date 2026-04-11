---
name: temporal-coupling-detector
description: Use when code breaks because functions were called in the wrong order, when objects must be "initialized" before use but nothing prevents using them uninitialized, when setup/teardown sequences exist and forgetting a step causes silent corruption, or when parallelizing sequential code causes mysterious failures. Trigger on "why does this work in the test but fail in production?", "it worked until we changed the call order", or when reviewing multi-step object setup. NOT for intentional pipelines with type-enforced ordering, framework lifecycle hooks managed by the framework, or database transactions.
---

# Temporal Coupling Detector

One of the most insidious forms of coupling — ordering dependencies required but invisible. If `init()` before `process()` is required but nothing enforces it, every caller must just know. The cost isn't immediately obvious: a test passes because the setup happens to occur in the right order. Code works in development, fails in production because initialization runs on a different thread. A refactor parallelizes sequential operations and introduces a race condition no one saw. Fowler and Beck call this a code smell; Kent Beck recommends encoding ordering into the type system so it cannot be violated.

**Core principle:** If code must execute in a specific order, that ordering must be enforced by the design — through types, parameters, or API structure — not by documentation or convention. Convention fails at scale. Types prevent failure.

## When to Use

- Functions or methods that must be called in a specific order but nothing prevents the wrong order
- Objects that must be "initialized" before use, but construction and initialization are separate steps
- Setup/teardown sequences where forgetting a step causes silent corruption instead of an exception
- Code that works sequentially but breaks when parallelized (race condition from hidden order dependency)
- Multi-step processes where the first step's output is required by the second step
- State machines where only certain operations are valid in certain states
- "Why does this work in the test but fail in production?" / "It worked until we changed the call order"
- When reviewing patterns like `obj.open(); obj.process(); obj.close()`

**Not for:** Type-enforced pipelines (where the type system already prevents wrong order), framework lifecycle hooks managed by the framework (Spring lifecycle, React lifecycle), database transactions with explicit semantics, intentional command sequences.

## The Process

### 1. Detect Hidden Order Dependencies

For each sequence of operations, identify whether one depends on the prior execution of another. There are five patterns:

**Two-phase initialization** — Construction and initialization are separate
- Signal: Constructor sets up the object; `.init()` or `.setup()` must be called before use
- Risk: Nothing prevents calling `process()` before `.init()`; caller must know the hidden contract
- Example: `new DatabaseService()` followed by `dbService.connect()` — but `query()` will fail silently or crash if `connect()` wasn't called
- Silent corruption: If connection isn't established, queries return cached stale data or undefined behavior

**Method order dependencies** — One method assumes another method has already run
- Signal: Method B reads state set by method A; no enforcement that A ran first
- Risk: Calling B before A produces undefined behavior or uses default values
- Example: `stream.on('data', handler)` then `stream.resume()` vs. `stream.resume()` then `stream.on('data', handler)` — order matters, but nothing stops you from reversing it
- Silent corruption: Data arrives before handler is attached; data is silently lost

**Prepare/execute patterns** — Sequence of void methods that build internal state
- Signal: `configure()` → `prepare()` → `execute()` where each modifies state, but order is opaque
- Risk: Forgetting a step silently corrupts the operation or produces wrong results
- Example: `ReportGenerator.setFormat('pdf')` → `setOutputPath('/tmp')` → `generate()` — if you forget `setOutputPath()`, generator writes to a default location and you don't discover this until review

**Invisible preconditions from prior calls** — Operation requires output or side effect from a previous operation
- Signal: Function B silently assumes state set by function A, with no parameter connection
- Risk: Caller must understand the hidden dependency; refactoring order causes subtle bugs
- Example: `authenticateUser(token)` sets a global `currentUser` context, then `fetchSecretData()` reads that context. If you call `fetchSecretData()` before `authenticateUser()`, you get a security failure or null reference error that looks random

**Resource lifecycle violations** — Resources (files, connections, sockets) have open/close or acquire/release pairs
- Signal: `resource.open()` / `resource.close()` or `acquire()` / `release()` with nothing preventing use outside the lifecycle
- Risk: Using resource after close produces "file not found" or "connection closed" errors; using without open produces "resource not initialized" errors
- Example: File handle is open in one coroutine and close is called in another; writes between the two fail mysteriously

### 2. Classify Each Dependency

For each ordering dependency found:

```
TEMPORAL: [what depends on what]
  Type:       [two-phase init / method order / prepare-execute / invisible precondition / resource lifecycle]
  Sequence:   [A → B required order]
  Enforced:   [yes / no]
  Evidence:   [file:line for each step]
  Failure:    [exception / silent corruption / resource leak / undefined behavior]
```

The critical field is **Enforced**: if the order is not enforced by the type system or API structure, it's a defect waiting to happen.

Example:

```
TEMPORAL: DatabaseService initialization
  Type:       two-phase init
  Sequence:   new DatabaseService() → dbService.connect() required before query()
  Enforced:   no — constructor doesn't call connect(); query() has no guard
  Evidence:   src/db/service.ts:15 (constructor), :45 (connect), :67 (query with no check)
  Failure:    silent corruption — query returns cached/undefined data if connection never opened
```

### 3. Apply Fix Patterns

For each unenforced dependency, propose a fix. There are five core patterns:

**Merge into single operation** — Constructor or factory method does all initialization atomically
- Instead of: `new Service()` then `.init()`, use: `Service.create()` that fails if init fails
- Benefit: Impossible to have an uninitialized Service in the codebase
- Example: `const service = await DatabaseService.create(config)` — the caller gets a fully-initialized service or an error, never a half-initialized object

**Encode sequence in types (builder/state machine)** — Type system represents each phase
- Instead of: `obj.configure()` → `obj.prepare()` → `obj.execute()`, use builder or state types
- `obj.configure()` → `ConfiguredService` → `.prepare()` → `PreparedService` → `.execute()`
- Each step returns a new type; only the next step is available on that type
- Benefit: Compiler enforces order; you cannot call `execute()` on a Service, only on a PreparedService
- Example TypeScript:
  ```typescript
  interface Service { configure(opts: Options): ConfiguredService; }
  interface ConfiguredService { prepare(): PreparedService; }
  interface PreparedService { execute(): Promise<Result>; }
  ```

**Require preconditions as parameters** — A's output becomes B's input explicitly
- Instead of: `authenticate(token)` sets global context, `fetchSecret()` reads context
- Use: `fetchSecret(auth: AuthContext)` where `authenticate()` returns `AuthContext`
- Benefit: Type system enforces the dependency; call order no longer matters
- Example: `const auth = authenticate(token); const secret = fetchSecret(auth);`

**RAII / disposable / using pattern** — Encode resource lifecycle in scope
- Instead of: `file.open()` ... `file.close()` with risk of forgetting close or using after close
- Use: `using(file = new File(path), () => { /* file is open here */ })` — file is closed when block exits
- Or: `try { file.open(); ... } finally { file.close(); }` with guard checks
- Benefit: Scope enforces lifecycle; resource cannot be used after close within that scope
- Example TypeScript: `const result = await using(new Connection(url), async (conn) => conn.query(sql));`

**Factory methods** — Single point of creation that returns fully-initialized objects
- Instead of: `new Service()` optionally followed by `.init()`
- Use: `const service = Service.create(config)` that internally handles all setup and returns initialized service
- If initialization can fail: `const result = await Service.create(config); if (result.isOk()) { /* use service */ }`
- Benefit: Caller cannot create uninitialized Service; factory ensures invariants

### 4. Temporal Coupling Report

For each dependency analyzed:

```
TEMPORAL: [description]
  Type:       [type]
  Sequence:   [A → B]
  Enforced:   [yes/no]
  Location:   [file:line for each step]
  Failure:    [what breaks]
  Fix:        [specific pattern and implementation]
```

### Example 1: DatabaseService Two-Phase Init

Original code:

```typescript
class DatabaseService {
  private connection?: PgClient;
  
  constructor(config: DatabaseConfig) {
    this.config = config;
  }
  
  async connect(): Promise<void> {
    this.connection = new PgClient(this.config);
    await this.connection.connect();
  }
  
  async query(sql: string): Promise<any[]> {
    // Silent failure: if connection is undefined, returns []
    return this.connection?.query(sql) ?? [];
  }
}

// Caller must know the contract
const db = new DatabaseService(config);
await db.connect();  // Easy to forget
const results = await db.query("SELECT ...");  // Fails silently if connect() was forgotten
```

**Temporal Coupling:** Two-phase init where `connect()` must precede `query()`, but nothing enforces it.
**Failure:** Silent corruption — query returns empty array if connection was never initialized.

Fix — Factory method (merge into single operation):

```typescript
class DatabaseService {
  private constructor(private connection: PgClient) {}
  
  static async create(config: DatabaseConfig): Promise<DatabaseService> {
    const connection = new PgClient(config);
    await connection.connect();
    return new DatabaseService(connection);
  }
  
  async query(sql: string): Promise<any[]> {
    return this.connection.query(sql);
  }
}

// Caller gets initialized service or error; cannot create uninitialized service
const db = await DatabaseService.create(config);
const results = await db.query("SELECT ...");
```

### Example 2: ReportGenerator Prepare/Execute

Original code:

```typescript
class ReportGenerator {
  private format?: string;
  private outputPath?: string;
  
  setFormat(fmt: string): void {
    this.format = fmt;
  }
  
  setOutputPath(path: string): void {
    this.outputPath = path;
  }
  
  generate(data: any[]): void {
    // Silent failure: if outputPath is undefined, writes to default location
    const path = this.outputPath ?? './report-default.pdf';
    // format is undefined if not set
    const fmt = this.format ?? 'pdf';
    /* write report to path in fmt format */
  }
}

// Caller must remember the sequence
const gen = new ReportGenerator();
gen.setFormat('pdf');
gen.setOutputPath('/tmp/report.pdf');
gen.generate(data);  // Works

// But caller could forget setOutputPath and not notice until review
const gen2 = new ReportGenerator();
gen2.setFormat('pdf');
gen2.generate(data);  // Silent corruption: wrote to ./report-default.pdf
```

Fix — Encode sequence in types (builder pattern):

```typescript
class ReportBuilder {
  constructor(private data: any[]) {}
  
  withFormat(fmt: string): ReportFormattedBuilder {
    return new ReportFormattedBuilder(this.data, fmt);
  }
}

class ReportFormattedBuilder {
  constructor(private data: any[], private format: string) {}
  
  toFile(path: string): ReportWithPathBuilder {
    return new ReportWithPathBuilder(this.data, this.format, path);
  }
}

class ReportWithPathBuilder {
  constructor(
    private data: any[],
    private format: string,
    private path: string
  ) {}
  
  generate(): void {
    /* write report using all three required fields */
  }
}

// Type system enforces order
const report = new ReportBuilder(data)
  .withFormat('pdf')
  .toFile('/tmp/report.pdf')
  .generate();  // Only generate() is available on final builder

// Impossible to forget withFormat() or toFile()
```

### Example 3: Invisible Precondition

Original code:

```typescript
let currentUser: User | undefined;

function authenticate(token: string): void {
  const user = validateToken(token);
  currentUser = user;  // Sets global state
}

function fetchSecretData(): SecretData[] {
  if (!currentUser) {
    // Fails silently or returns empty
    return [];
  }
  return database.fetchSecretsFor(currentUser.id);
}

// Caller must know authenticate() must run first
authenticate(token);
const secrets = fetchSecretData();  // Works

// But caller could reverse the order
const secrets2 = fetchSecretData();  // Returns [] silently, not an error
authenticate(token);
```

Fix — Require preconditions as parameters:

```typescript
interface AuthContext {
  userId: string;
}

function authenticate(token: string): AuthContext {
  const user = validateToken(token);
  return { userId: user.id };
}

function fetchSecretData(auth: AuthContext): SecretData[] {
  return database.fetchSecretsFor(auth.userId);
}

// Type system enforces the dependency
const auth = authenticate(token);
const secrets = fetchSecretData(auth);

// Cannot call fetchSecretData() without AuthContext; impossible to forget authenticate()
```

## Interaction Model

Decision engine. The agent analyzes code for hidden ordering dependencies, prioritizing unenforced dependencies with silent corruption potential (worse than exceptions). When reviewing code, it identifies multi-step initialization, method order assumptions, and resource lifecycle issues, then recommends specific fixes from the five patterns. The agent doesn't eliminate all sequencing — intentional pipelines with type enforcement are fine — but it removes *invisible* dependencies.

## Temporal Coupling Patterns Reference

1. **Make A's output B's input.** If B assumes state set by A, have A return that state and B accept it as a parameter. Dependency becomes explicit in the type signature.
2. **Encode phases in types.** If operations must happen in sequence, create separate types for each phase. The type system enforces order.
3. **Merge steps that always occur together.** If init and use are separate but always paired, combine them in a constructor or factory. Make the invariant impossible to violate.
4. **Use the language idiom for resources.** Scope-based resource management (destructors, using statements, try-finally) enforces lifecycle without explicit close() calls.
5. **Convention is not enforcement.** Documentation, comments, and naming are better than nothing, but the type system is better than documentation. Prioritize preventing the defect over detecting it.

## Guard Rails

**Not all ordering is temporal coupling.** A SQL query is a sequence, but the sequence is intentional and type-enforced (you can't execute a query before building it). DB transactions have phases, but the transaction itself enforces atomicity. These are not temporal coupling defects.

**Two-phase init is sometimes unavoidable.** In async/await patterns, initialization may require awaiting futures. The fix isn't always to merge; sometimes the fix is to encode the phases in types (separate "Connecting" and "Connected" types) so the compiler enforces order.

**Resource lifecycle varies by language.** Python's `with` statement, C++'s RAII destructors, Java's try-with-resources, and Rust's ownership rules encode lifecycle differently. Use the idiom of your language; don't force one pattern across all contexts.

**Don't over-engineer trivial setup.** If you have three steps in main() to initialize a service, that's often fine — it's the composition root, and it's okay to be specific. Over-engineering a builder for "configure → initialize → execute" when the sequence only happens once in a factory function is premature.

**Distinguish framework-managed from user-managed order.** If a framework manages initialization order (Spring lifecycle, React hooks), you don't control it and shouldn't try to re-enforce it. But if user code manages the order, enforce it.

## Common Mistakes

| Mistake | Why It Fails | Fix |
|---------|-------------|-----|
| Runtime checks instead of prevention | Try to guard every operation: `if (!initialized) throw Error()` | Encode order in types so wrong order is impossible, not just runtime-checked |
| Documentation as enforcement | Comment "must call init() before query()" | Use types and parameters; comments fail at scale |
| Builder without ordering enforcement | Create a builder but all setters are optional | Each builder step returns a new type with only the next valid step available |
| Hiding ordering in a facade | Create a wrapper that calls steps in order but hides them from caller | Fine for composition root, but not for reusable components; reusable code should encode order explicitly |
| Parallelizing without checking dependencies | Parallelize sequential operations and discover at runtime that order matters | Review for temporal coupling first; make sure dependencies are explicit before parallelizing |
| Treating all two-phase init as a problem | Try to merge unrelated constructor and async initialization | Two-phase init is fine if encoded in types; problem is when uninitialized objects are usable |

## Cross-References

→ `contract-enforcer` — temporal coupling is a type of broken contract. The ordering requirement exists but is invisible. Encoding it as a type or parameter makes the contract explicit and enforceable.
→ `type-driven-designer` — type systems are the primary tool for preventing temporal coupling. Builder patterns, state machine types, and parameter requirements are all type-level solutions.
→ `cqs-auditor` — temporal coupling often arises when commands modify shared state that subsequent queries or commands depend on. Separating commands from queries makes state dependencies visible.
