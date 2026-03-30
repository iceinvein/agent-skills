---
name: contract-enforcer
description: Use when writing or modifying functions with non-trivial logic — especially functions that handle external input, state transitions, or cross-module boundaries. Trigger on "is this correct?", "what are the edge cases?", "what does this function guarantee?", or when reviewing boundary behavior. NOT for trivial getters, simple mappings, or configuration code.
---

# Contract Enforcer

A structured correctness framework based on Bertrand Meyer's *Design by Contract*. Before writing or modifying non-trivial functions, the agent articulates preconditions, postconditions, invariants, and failure contracts — then verifies the implementation satisfies them.

**Core principle:** Every function participates in a contract. The caller promises preconditions, the function promises postconditions, and both rely on invariants. Code without an explicit contract has an implicit one — and implicit contracts breed bugs.

## When to Use

- Writing or modifying a function with non-trivial logic
- Functions that handle external input, state transitions, or cross-module boundaries
- "Is this function correct?" / "What are the edge cases?"
- "What does this function guarantee?"
- Reviewing boundary behavior or error handling

**Not for:** Trivial getters, simple property access, configuration code, pure mappings with obvious behavior.

## The Process

Before presenting code for any non-trivial function, articulate the contract. This is not optional overhead — it's how you discover bugs before writing them.

### 1. Preconditions

What must be true about inputs for this function to behave correctly?

Go beyond types. Types catch shape errors; preconditions catch semantic errors:
- "Array must be sorted" (not just "array of numbers")
- "userId must correspond to an existing user in the database" (not just "string")
- "Amount must be positive and in a supported currency" (not just "number")

For each precondition, answer: **If this is violated, does the function fail loudly or silently corrupt state?** Silent corruption is the worst outcome — it means the contract exists but isn't enforced.

### 2. Postconditions

What does this function guarantee about its output?

- What relationship holds between input and output?
- What state changes are guaranteed to have happened?
- What side effects are promised? What side effects are promised NOT to occur?
- Is the guarantee conditional (e.g., "returns sorted array IF input was non-empty")?

A postcondition should be specific enough to write a test from. "Returns the correct result" is not a postcondition — it's a wish.

### 3. Invariants

What must remain true throughout execution?

- **Class/module invariants** this function must preserve (e.g., "the balance is never negative")
- **Data structure invariants** (e.g., "the heap property is maintained")
- **Resource invariants** (e.g., "the database connection is returned to the pool, even on error")
- **Concurrency invariants** (e.g., "the lock is held during the critical section")

If the function temporarily violates an invariant (e.g., rebalancing a tree), note where it's restored.

### 4. Failure Contract

When preconditions are violated, what happens? The answer must be explicit:

- **Throw** a specific, named error type — not a generic `Error("something went wrong")`
- **Return** an error union or result type — with the error case documented
- **Never** return a magic value (null, -1, empty string) without documenting what it means

"Undefined behavior" is not a contract. If you can't state what happens on bad input, you don't understand the function yet.

### 5. Verify Implementation

After articulating the contract, evaluate the actual code:
- Are preconditions **enforced** at the function boundary, or merely **assumed**?
- Does the implementation actually satisfy the postconditions for all valid inputs?
- Are invariants maintained across all code paths, including error paths?
- Does the failure behavior match the failure contract?

If the implementation doesn't match the contract, either fix the implementation or revise the contract — but never leave them misaligned.

## Output Format

Present contracts as a structured block alongside the code:

```
CONTRACT: functionName(param1, param2)
  Requires: [preconditions — semantic, not just types]
  Ensures:  [postconditions — what the caller can rely on]
  Invariant: [what is preserved across the call]
  On violation: [specific failure behavior]
```

Example:

```
CONTRACT: calculateShippingCost(order, destination)
  Requires: order.items.length > 0, all items have weight > 0, destination is valid ISO 3166-1 alpha-2
  Ensures:  returns { cost: number > 0, currency: order.currency }, does not modify order
  Invariant: shipping rules table is not mutated
  On violation: throws InvalidOrderError (bad order) or UnsupportedDestinationError (bad destination)
```

## Interaction Model

Produce contracts independently for anything derivable from code. But **ask the human** for semantic preconditions you can't determine alone:

- "Should this accept negative quantities, or is that a precondition violation?"
- "When the user isn't found, should this throw or return null? That's a contract decision — it affects every caller."
- "Is an empty array a valid input here, or should it be rejected?"

These are design decisions, not implementation details. The human owns them.

## Anti-Patterns

| Pattern | Problem |
|---------|---------|
| `if (!x) return null` without documentation | Silent failure — caller doesn't know null means "contract violated" vs "legitimate absence" |
| Defensive checks buried deep inside the function | Preconditions should be checked at the boundary, not scattered through logic |
| Return type is `any` or overly broad union | Postcondition is too vague to be useful — what does the caller actually get? |
| Function modifies its inputs without declaring it | Hidden side effect — violates caller's assumption of immutability |
| "Works for all inputs" | Almost certainly false — name the actual domain |
| Catching all exceptions and returning a default | Converts loud failure into silent corruption — the worst trade |
| Error messages that don't identify which precondition failed | "Invalid input" tells the caller nothing — name the violated condition |

## Guard Rails

**Scale to the function.** A 3-line pure function doesn't need a formal contract block. Use judgment — the overhead should be proportional to the function's complexity and the consequences of getting it wrong.

**Contracts are for humans, not compilers.** Write contracts that a developer reading the code can understand and verify. Don't write contracts in formal logic unless the team reads formal logic.

**Don't gold-plate.** If the function has one obvious precondition and one obvious postcondition, state them briefly. The format is a tool, not a ritual.

**Contracts evolve.** When requirements change, update the contract first, then the implementation. A stale contract is worse than no contract — it's actively misleading.

## The Meyer Principles (Reference)

1. **Separate commands from queries.** Functions that return values should not have side effects. Functions with side effects should not return values. When you must violate this, document it in the contract.
2. **Demand no more, promise no less.** Preconditions should be as weak as possible (accept the widest reasonable input). Postconditions should be as strong as possible (guarantee the most specific output).
3. **The client is responsible for preconditions.** The function does not need to "handle" invalid input gracefully — it needs to fail clearly and immediately when preconditions are violated.
4. **Inheritance respects contracts.** Subtypes may weaken preconditions (accept more) and strengthen postconditions (guarantee more), but never the reverse.
5. **Contracts are documentation that compiles.** The best contracts are checked at runtime (assertions, type narrowing, validation) — not just written in comments.
