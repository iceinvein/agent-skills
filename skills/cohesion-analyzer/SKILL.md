---
name: cohesion-analyzer
description: Use when a module, class, or file is doing "too many things", when a file keeps growing and accumulating unrelated responsibilities, when you can't name what a module does in one sentence without using "and", or when test setup requires mocking unrelated concerns. Trigger on "this file is a mess", "what does this class even do?", or when reviewing oversized modules. NOT for interactions between modules, whether the right things are hidden behind a boundary, or single-function utilities.
---

# Cohesion Analyzer

A structural analysis framework based on Constantine & Yourdon's *Structured Design* (1979). Cohesion measures how strongly elements within a module belong together. The strength of cohesion exists on a spectrum from coincidental (weakest) to functional (strongest). The twin of coupling-auditor — coupling is about *between* modules, cohesion is about *within* a module.

**Core principle:** If you can't describe what a module does in one sentence without using "and," it has more than one responsibility.

## When to Use

- When a module, class, or file is doing "too many things"
- When a file keeps growing and accumulating unrelated responsibilities
- When you can't name what a module does in one sentence without using "and"
- When test setup requires mocking unrelated concerns
- When reviewing oversized modules or noticing high churn in a single file
- "This file is a mess" / "What does this class even do?" / "I had to edit this for three different reasons this month"

**Not for:** Interactions between modules (that's coupling, use coupling-auditor), whether the right things are hidden behind a boundary (that's module-secret-auditor), or single-function utilities (they're already at the limit of cohesion).

## The Process

### 1. Identify Responsibilities

List every distinct responsibility—every reason the module might need to change. A responsibility is a reason to change, not a method or property.

Examples:
- "UserRepository" has: *persist user data to database*, *validate user fields*, *hash passwords*, *log access*. That's 4 responsibilities.
- "InvoiceGenerator" has: *calculate line item subtotals*, *apply tax rules*, *format currency*, *write PDF layout*, *send to cloud storage*. That's 5.

Be specific. "Do user stuff" is not a responsibility. "Validate email format, hash passwords, check database availability" are.

### 2. Classify on the Spectrum

For each module, assess where it lands on the 7-level cohesion spectrum from weakest to strongest:

**Coincidental Cohesion** (weakest — always fix)
- Elements have no relationship; grouped only by historical accident or "it needs to go somewhere"
- Example: A utils.ts file with `calculateTax()`, `getCurrentTime()`, `hashPassword()`, `sendEmail()`, and `parseCSV()` — nothing is related
- Risk: Impossible to name, changes for one reason affect unrelated code, high test fragility
- Causes: "Dumping ground" files, fear of creating new modules, overuse of utils

**Logical Cohesion**
- Elements are in the same category or kind, but serve different purposes
- Example: All validators grouped together (EmailValidator, PhoneValidator, URLValidator), but each is independent
- Risk: Caller must know which validator to use; changes to validator interface affect all; tests require mocking unrelated validators
- Causes: Organizing by type or layer rather than by purpose

**Temporal Cohesion**
- Elements are grouped because they happen at the same time
- Example: An init() function that calls multiple unrelated setup tasks, or a shutdown() hook that closes unrelated resources
- Risk: Hard to test individually, changes in one startup concern affect all, ordering becomes invisible dependency
- Causes: Lifecycle hooks, setup/teardown patterns grouping unrelated concerns

**Procedural Cohesion**
- Elements are connected by sequence or control flow, but operate on different data
- Example: A ProcessOrder function that checks inventory, deducts from stock, calculates shipping, logs transaction, sends email — sequential but separate concerns
- Risk: Changes to one step affect the whole; testing requires mocking unrelated systems; hard to reuse steps in other contexts
- Causes: "Happy path" functions that orchestrate multiple unrelated steps

**Communicational Cohesion**
- Elements operate on the same data but perform different operations
- Example: A User class with `validateEmail()`, `encryptPassword()`, `logLogin()`, `buildJSON()` — all work on user data but do different things
- Risk: You can't change the data structure without understanding all operations; methods are coupled through shared state; hard to name
- Causes: Object-oriented design that groups methods by data ownership rather than by purpose

**Sequential Cohesion**
- The output of one element feeds directly into the next; it's a pipeline
- Example: ParseInput() → ValidateData() → TransformData() → WriteOutput() — each step's output is the next's input
- Risk: Lower than communicational, but still couples steps; changes to intermediate format affect all downstream steps
- Causes: ETL processes, compiler phases, data transformation pipelines

**Functional Cohesion** (strongest — the goal)
- Every element contributes to a single, well-defined purpose; can't remove anything without breaking that purpose
- Example: A PaymentProcessor module that *processes payments via gateway API*. Every method, field, and helper serves only this purpose.
- Risk: Minimal. Changes are localized. Easy to name, test, reason about, and reuse.
- Causes: Disciplined design; clear domain concepts; single responsibility

### 3. Find Split Lines

Once you've identified multiple responsibilities, propose specific extractions. Name each new module clearly and verify it has a single, nameable purpose.

Don't just say "split this." Say:
- "Extract PasswordValidator into its own module: `validate(password: string): ValidationResult`"
- "Move email sending to EmailService: `send(to, subject, body): Promise<void>`"
- "Create TaxCalculator: `calculate(items, location): TaxAmount`"

Each extracted module should pass the one-sentence test: "This module [specific action]."

### 4. Cohesion Report

For each module analyzed:

```
COHESION: [module name] ([file path])
  Level:            [level]
  Responsibilities: [list of reasons to change]
  Signal:           [evidence of low cohesion]
  Split:            [extraction or "none"]
  Result:           [what remains]
```

Example:

```
COHESION: UserService (src/users/service.ts)
  Level:            communicational — all methods work on user data but do different things
  Responsibilities: validate fields, hash passwords, persist to database, log access, send welcome email
  Signal:           file keeps growing; tests require mocking database, email, and logging unrelated to each test; can't name in one sentence
  Split:            Extract PasswordHasher (pure function), EmailNotifier (separate class), AccessLogger (separate class)
  Result:           UserService focuses on: fetch user, create user, update user (data operations only)
```

## Interaction Model

Decision engine. The agent analyzes cohesion in modules it reviews or refactors, producing the cohesion report. When reviewing existing code, it identifies the lowest-cohesion modules (coincidental and logical first) and recommends targeted extractions. The agent targets the largest, most-changed files first—they're the best signal of cohesion problems. It doesn't aim for every module to reach functional cohesion; it balances practicality (some temporal/procedural cohesion is acceptable in init/shutdown) with clarity (modules should be nameable, testable, and reasonably sized).

## Cohesion vs. Coupling

Cohesion and coupling are related but distinct concerns:

- **High cohesion + high coupling** = modules are internally focused but too dependent on each other. Fix the coupling (coupling-auditor).
- **Low cohesion + low coupling** = modules are independent but internally disorganized. Fix the cohesion (this skill).
- **Low cohesion + high coupling** = the worst case. The module can't be named or tested in isolation *and* breaks other modules. Fix cohesion first.
- **High cohesion + low coupling** = the goal. Modules are internally focused and externally independent.

This skill addresses cohesion only. If your problem is about how modules interact, use coupling-auditor instead.

## Guard Rails

**Don't chase functional everywhere.** Some temporal and procedural cohesion is acceptable—initialization routines, shutdown hooks, and orchestration steps inherently group unrelated concerns by timing or sequence. The question is: does it cause real problems (untestable code, high churn, unclear naming)? If not, leave it.

**Size is a signal, not a metric.** A 500-line file with functional cohesion is fine. A 50-line file with coincidental cohesion is a problem. Length alone doesn't indicate cohesion problems; clarity and change frequency do.

**Respect domain concepts.** Some grouping comes from the domain itself. A User aggregate may legitimately hold validation, persistence, and notification concerns if the domain says "the User is responsible for these." Challenge that—but don't force extractions that violate domain boundaries.

**Don't split prematurely.** If two responsibilities change together 90% of the time, they may belong together *right now*, even if they're logically distinct. Watch for change patterns before splitting.

**The "and" test is a starting point, not gospel.** If you say "UserService validates and persists and notifies," that's three responsibilities. But if you say "UserService manages the user lifecycle," that might be one cohesive purpose. Listen to the domain language.

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Splitting by layer instead of by purpose | Don't create "Controllers", "Services", "Repositories" folders if modules in each have low cohesion. Split by responsibility: PaymentService (one responsibility), UserRepository (one responsibility). |
| Using "utils" as the home for unrelated code | Utils, helpers, and common folders become dumping grounds. Every function should belong to a module with a clear, nameable purpose. |
| Confusing "multiple methods" with "low cohesion" | A class with 10 methods is fine if all 10 serve a single purpose. A class with 3 methods serving different purposes has low cohesion. |
| Over-splitting | Extract only when split lines are clear and the new modules are genuinely reusable or testable. Don't create single-method "modules" unless they're called from multiple places. |
| SRP ≠ one function | Single Responsibility Principle doesn't mean one method per class. It means one *reason to change*. A class can have many methods if they all serve the same purpose. |

## Cross-References

→ **coupling-auditor** — the twin skill. Coupling is between modules; cohesion is within.

→ **module-secret-auditor** — when the question is what should be hidden or exposed, not whether the module's internal responsibilities are clear.

→ **dependency-direction-auditor** — use to determine if cohesion problems are symptoms of dependency direction issues (e.g., a module has low cohesion because it's serving multiple layers).
