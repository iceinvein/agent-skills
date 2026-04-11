---
name: composability-auditor
description: Use when functions or modules are hard to reuse because they do too much or assume too much about their environment, when building a new feature requires modifying existing code instead of combining existing units, when functions have hardcoded dependencies on specific data sources or output formats, or when testing requires elaborate setup because the unit manages its own I/O. Trigger on "I need exactly what this does but with slightly different output", "why can't I reuse this?", or when adding a feature means adding a flag to an existing function. NOT for top-level orchestration code, performance-critical paths, or one-off scripts.
---

# Composability Auditor

Unix Philosophy isn't about shell pipes — it's about designing units that can be combined. A composable unit does one thing, takes standard input, produces standard output. The philosophy emerged from Bell Labs where a small team built an operating system by composing thousands of small tools. The constraint wasn't ideology; it was pragmatism: composability meant reuse, and reuse meant velocity. You don't repeat yourself; you combine what already works.

**Core principle:** Build complex behavior by combining simple units, not by making units complex. Composability requires giving up self-sufficiency in exchange for combinability. The hardest design tradeoff is: should this unit manage its own I/O and setup, or should it take them as inputs and let the caller decide? Composable units choose the latter.

## When to Use

- Functions or modules that are hard to reuse in a different context
- Building a new feature requires modifying existing code instead of combining existing pieces
- Functions have hardcoded dependencies on specific data sources or output formats
- Testing requires elaborate setup because the unit manages its own I/O or side effects
- Adding a feature means adding a flag to an existing function instead of creating a new composable piece
- "I need exactly what this does but with slightly different output format"
- "Why can't I just reuse this function?"

**Not for:** Composition roots/main()/route handlers (they must orchestrate), performance-critical paths (composition can add overhead), one-off scripts (pragmatism trumps theory).

## The Process

### 1. Identify Composability Blockers

For each function or module, check these five properties. A blocker is something that prevents the unit from being easily reused in a new context.

**Does one thing** — The unit's responsibility fits in a sentence without "and"
- Signal of failure: "generates a report and emails it" or "fetches user data and caches it"
- Impact: Unit can't be used alone; caller must accept side effects they may not want
- Example blocker: `processReport()` that both generates and emails the report

**Standard interfaces** — The unit takes and returns simple, generic types, not framework-specific types
- Signal of failure: `processRequest(HttpRequest)` → `HttpResponse`, or `service.execute(Context)` → `Promise<void>`
- Impact: Unit ties you to a framework; reuse requires adapting the framework
- Example blocker: Function takes a `SpringContext` or `ExpressRequest` instead of plain data

**No hidden inputs** — The unit doesn't depend on environment variables, global state, singletons, or configuration
- Signal of failure: Function reads `process.env.API_KEY`, or calls `Logger.getInstance()`, or depends on `AppState`
- Impact: Unit can't work in a different environment; setup becomes opaque
- Example blocker: `fetchUser()` reads `process.env.DATABASE_URL` instead of taking it as a parameter

**No hidden outputs** — Results go through the return value only; no side effects except what the caller expects
- Signal of failure: Function modifies a shared cache, sends a log to a central service, or updates a global counter
- Impact: Unit's behavior depends on order of execution and shared state; testing is fragile
- Example blocker: `validate()` modifies a shared validation results object instead of returning them

**Stateless where possible** — Each call is independent; no internal state that must persist between calls or be initialized first
- Signal of failure: Object must be constructed then initialized with `.init()`, or stores state across calls
- Impact: Unit can't be used as a pure function; caller must manage state lifecycle
- Example blocker: `ReportEngine` object that must be created and `.init()` called before `.generate()`

### 2. Classify Each Blocker

For each blocker, document it with evidence and impact.

```
COMPOSABILITY BLOCKER: [unit name]
  Property:   [does one thing / standard interfaces / no hidden inputs / no hidden outputs / stateless]
  Evidence:   [code reference: file:line showing the problem]
  Blocks:     [what can't be reused because of this]
  Impact:     [what caller must accept they don't want]
```

Example:

```
COMPOSABILITY BLOCKER: processReport
  Property:   does one thing — actually does two: generate + email
  Evidence:   src/reports/processor.ts:42 calls email.send() inside the function
  Blocks:     can't use processReport for local file output, can't use without side effect
  Impact:     caller must accept email being sent even if they only wanted the report
```

### 3. Apply Decomposition Patterns

For each blocker, propose a decomposition. There are five core patterns:

**Does too much → Pipeline stages**
- Split into smaller units that do one thing each
- First unit generates report, second unit formats it, third unit emails it
- Caller composes: `const report = generate(data); const formatted = format(report); email(formatted)`
- Benefit: Each unit is reusable independently; caller controls the pipeline

**Non-standard interface → Extract adapter, core takes simple data**
- Core logic should take simple types (objects, arrays, primitives), not framework types
- Create an adapter that translates framework types to simple types
- Example: Instead of `process(HttpRequest) → HttpResponse`, decompose to `processData(data: T) → Result<U>` and let the framework adapter handle the HTTP wrapping
- Benefit: Core logic is framework-agnostic; reusable in CLI, tests, other frameworks

**Hidden input → Explicit parameter**
- Move secret inputs (env vars, globals, singletons) into explicit parameters
- Instead of `fetchUser()` reading `DATABASE_URL`, call `fetchUser(connectionString)`
- Caller decides where the connection string comes from; unit doesn't care
- Benefit: Unit works in any environment without setup surprises

**Hidden output → Return result, let caller decide**
- Move side effects into the caller's domain
- Instead of `validate()` modifying a shared results object, `validate()` returns validation results
- Caller decides what to do: log them, store them, display them
- Benefit: Unit has no side effects; testable as a pure function

**Stateful → Pass state in, get state out (reducer pattern)**
- Convert internal state into input/output
- Instead of `.init()` then `.generate()`, make `generate(config, previousState) → { result, newState }`
- Benefit: Unit becomes composable; each call is independent

### 4. Composability Report

For each unit analyzed:

```
COMPOSABILITY: [unit name] ([file path])
  Blockers:     [list each blocker: "does two things", "hidden input: DATABASE_URL", etc.]
  Evidence:     [code references where each blocker appears]
  Reuse impact: [specific scenarios that are blocked: "can't reuse for file output", "can't test without env var"]
  Fix:          [decomposition — name new units and their contracts]
  Composition:  [how new units combine to replicate the original behavior]
```

### Example: processReport with 3 Blockers

Original `processReport()` does three things, reads environment, and sends email:

```typescript
function processReport(orderId: string) {
  const db = createConnection(process.env.DATABASE_URL);  // Hidden input
  const orders = db.query(`SELECT * FROM orders WHERE id = ${orderId}`);
  const report = formatReport(orders);  // Fine
  const email = process.env.EMAIL_SERVICE_KEY;  // Hidden input
  sendEmail(email, report);  // Side effect: hidden output
  db.close();
}
```

Blockers:
1. Does too much: Fetches, formats, and emails
2. Hidden inputs: Reads DATABASE_URL and EMAIL_SERVICE_KEY
3. Hidden outputs: Side effect (email send) with no return value for testing

Decomposed into three units:

```typescript
// Unit 1: Fetch data — takes connection as parameter
function fetchOrderReport(db: Database, orderId: string): Report {
  const orders = db.query(`SELECT * FROM orders WHERE id = ${orderId}`);
  return formatReport(orders);
}

// Unit 2: Prepare email — pure, takes all inputs explicitly
function prepareReportEmail(report: Report, recipientEmail: string): EmailMessage {
  return {
    to: recipientEmail,
    subject: "Report",
    body: report.html
  };
}

// Unit 3: Send — isolated side effect
function sendEmail(service: EmailService, message: EmailMessage): Promise<void> {
  return service.send(message);
}

// Composition — caller orchestrates
async function processReport(orderId: string, config: Config) {
  const db = createConnection(config.databaseUrl);  // Config passed in
  const report = fetchOrderReport(db, orderId);
  const email = prepareReportEmail(report, config.recipientEmail);
  await sendEmail(emailService, email);
  db.close();
}
```

Now each unit is composable:
- `fetchOrderReport` works with any database connection
- `prepareReportEmail` is a pure function; testable without side effects
- `sendEmail` is an isolated effect; easy to mock or stub
- New contexts can reuse `fetchOrderReport` for CSV generation or PDF rendering without sending email

## Interaction Model

Decision engine. The agent analyzes units in code it writes or reviews, producing the composability report alongside the diff. When reviewing existing code, it identifies units that are hardest to reuse and recommends targeted decompositions. The agent doesn't force extreme composition (every helper function decomposed) — it focuses on functions that block reuse or complicate testing.

## The Unix Philosophy Reference

McIlroy, Pike, and Thompson articulated four principles (1978):

1. **Make each program do one thing well.** Concentrate all efforts on that one thing. Don't clutter the program with unrelated features.
2. **Expect the output of every program to become the input of another, yet unknown, program.** Don't insist on interactive input; don't produce extraneous information.
3. **Design and build software, even operating systems, to be tried early.** Don't hesitate to throw away clumsy parts and rebuild them.
4. **Use tools in preference to unskilled help to lighten a programming task.** Automate repetitive work; favor composition over manual effort.

Translated to functions and modules:

1. **One responsibility:** The function's description fits in a sentence without conjunctions.
2. **Composable interface:** Takes simple data, returns simple data; framework-agnostic.
3. **Testable in isolation:** No hidden dependencies or setup; pure or with explicit effects.
4. **Reusable before specialized:** Build the generic tool first; specialize through composition.

## Guard Rails

**Not all code should be maximally composable.** Composition has costs: more functions, more parameters, more indirection. Orchestration code at the edges (main, route handlers, setup) often *should* be specific and opinionated.

**Don't force stateless everywhere.** Some operations (database transactions, resource allocation) have inherent state phases. The fix isn't to make them stateless; it's to encode the phases in the type system so clients can't violate the contract.

**Composability is not decomposition.** Decomposition is about breaking large things into smaller things. Composability is about making those smaller things combinable. A function can be decomposed into five helpers that don't compose at all.

**Applies to APIs, not just CLI.** You might think composability is shell-pipe thinking. It applies equally to function interfaces, module contracts, service boundaries. Any API that takes simple data and returns simple data is composable.

**Composition comes with a cost.** More functions = more to understand. More parameters = more to pass. More generality = less optimized. Don't force composition on hot paths or when the alternative (a self-sufficient unit) is genuinely simpler and just-right.

**Prioritize reuse candidates.** Focus composability analysis on utilities (transformations, validation, formatting), business rules (calculations, decisions), and adapters. Orchestration code (route handlers, controllers, main loops) is fine being specific.

## Common Mistakes

| Mistake | Why It Fails | Fix |
|---------|-------------|-----|
| Extract every piece, even if not reused | Leads to "function per statement" and unreadable code | Only extract units that *are* or *could be* reused elsewhere |
| Pass too many parameters to avoid hidden inputs | Function signature becomes unreadable | Group related parameters into a config object; or accept "this is an internal detail and needs setup" |
| Ignore framework-specific types entirely | Sometimes the framework type *is* the right contract | Use composable core that's framework-agnostic; wrap it with framework adapters if needed |
| Make everything pure | Some operations (writing files, DB transactions) have inherent side effects | Make effects *explicit* and localized, not hidden |
| Create "too-generic" units that do nothing clearly | A function that does too little becomes a puzzle | The unit should answer "what problem does this solve?" in one sentence |
| Apply composability to UI components | UI state, layout, interaction are inherently bound | UI components can have composable logic *beneath* them; the component itself stays integrated |
| Assume decomposition = composability | Breaking into pieces doesn't mean the pieces fit together | Composability requires standard interfaces; decomposition just means splitting |

## Cross-References

- → cohesion-analyzer: Composability improves when modules have high cohesion (do one thing well). If a module is internally scattered, it can't be cleanly reusable.
- → simplicity-razor: Composability is a form of simplicity — simple enough to be understood and reused. A complex, heavily optimized unit that does three things is not simple.
- → cqs-auditor: Composability works best when queries (reads) and commands (writes) are separated. A function that both queries and modifies state is hard to reuse.
