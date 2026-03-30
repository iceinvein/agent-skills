---
name: unidirectional-flow-enforcer
description: Use when reviewing state management in UI applications, when data flows in multiple directions, when components directly mutate shared state, or when state updates cause unpredictable cascading re-renders. Trigger on "state is a mess", "I can't track where this value changes", "why did this re-render?", or when building any stateful UI with more than trivial complexity. NOT for server-side data pipelines or inter-service messaging.
---

# Unidirectional Flow Enforcer

A state management framework based on Evan Czaplicki's *Elm Architecture* (2012) and the Flux pattern. State flows in one direction: events flow up, state flows down, and mutations happen in exactly one place. When data flows in multiple directions — components reading and writing shared state, child components mutating parent state, event handlers directly modifying global stores — the result is unpredictable behavior, cascading re-renders, and state bugs that are impossible to reproduce.

**Core principle:** State → View → Event → Update → State. This is a cycle, not a web. If you can't trace any piece of state from its origin through its transformation to its rendering, the architecture has a flow violation.

## When to Use

- Building or reviewing stateful UI with more than trivial complexity
- State management feels chaotic — "I can't track where this value changes"
- Components directly mutate shared state
- State updates cause unexpected cascading effects
- "Why did this re-render?" / "State is a mess"
- Choosing or evaluating a state management approach
- When adding state to a previously stateless component

**Not for:** Server-side data pipelines (use Integration Pattern Auditor), inter-service messaging, static pages with no interactive state, or one-off prototypes where state architecture doesn't matter.

## The Process

### 1. Trace the Data Flow

For every piece of state in the component or page, trace its complete lifecycle:

**Where does it originate?** (Source)
- Server data (API response, database query)
- User input (form fields, selections, interactions)
- Derived/computed (calculated from other state)
- URL/navigation state (route params, query strings)
- System state (window size, online/offline, time)

**Where does it live?** (Location)
- Component-local state (useState, reactive ref)
- Shared/global store (Redux, Zustand, context, signals)
- Server cache (React Query, SWR, TanStack Query)
- URL (route params, search params)

**How does it change?** (Mutation path)
- Through a single, named update function (action/reducer/setter)
- Through direct mutation by any component that holds a reference
- Through implicit side effects (this is always a violation)

**How does it reach the view?** (Subscription path)
- Props passed down from parent
- Store subscription / selector
- Context consumption
- Direct import of a mutable reference (violation)

### 2. Check the Flow Direction

For each state → view → event chain, verify unidirectional flow:

**State flows DOWN**
- Parent components pass state to children via props or context
- Children never directly modify parent state
- State is read-only from the view's perspective

**Events flow UP**
- User interactions produce events (click, input, submit)
- Events are dispatched to an update function — they don't directly mutate state
- Child components emit events; parent components handle them

**Mutations happen in ONE PLACE**
- Each piece of state has exactly one update path (one reducer, one setter, one store action)
- Multiple components can dispatch events, but one function processes them
- No component reaches across boundaries to directly mutate another component's state

### 3. Detect Flow Violations

**Two-way binding without control** — A component both reads from and writes to a shared store directly, with no intermediary. Any component can mutate the store at any time.
- Symptom: state changes with no clear trigger; debugging requires searching every component for writes
- Fix: all mutations go through named actions/reducers; components dispatch, don't mutate

**Prop drilling mutation** — A setter function is passed through 5 layers of components to allow a deeply nested child to mutate ancestor state.
- Symptom: changing the setter's signature breaks a chain of components that don't use it
- Fix: use context, store subscription, or event bus for cross-cutting state; pass only the data down

**Side-effect state mutation** — State changes as a side effect of another operation (e.g., a useEffect that writes to a global store when a local value changes).
- Symptom: cascade of re-renders; state changes trigger other state changes trigger other state changes
- Fix: make the dependency explicit — derive the state computationally, or dispatch an event from the source

**Computed state stored as state** — A value that could be derived from existing state is stored independently, requiring manual synchronization.
- Symptom: the derived value gets out of sync with its source; bugs where "the total doesn't match the items"
- Fix: compute on read, don't store. Use selectors, computed properties, or memoized derivations.

**Direct import of mutable singleton** — Components import a module-level mutable object and read/write it directly, bypassing any state management.
- Symptom: changes don't trigger re-renders; state is "correct" in the variable but the UI doesn't reflect it
- Fix: wrap in a reactive primitive (store, signal, ref) that the framework can observe

### 4. Evaluate State Location

Use the Elm Architecture principle: state should live at the **lowest common ancestor** of the components that need it — no higher, no lower.

| State type | Best location | Why |
|------------|--------------|-----|
| Single component's UI state (open/closed, hover) | Component-local (useState/ref) | No other component needs it |
| Form data before submission | Component-local or form-scoped | Only the form components need it |
| Data shared by siblings | Nearest common parent | Lift state to where both can access it |
| App-wide user/auth state | Global store or context | Many components across the tree need it |
| Server data (API responses) | Server cache (React Query / SWR) | Separate from UI state — different lifecycle, different invalidation |
| URL-driven state | URL (route/query params) | Bookmarkable, shareable, survives refresh |

**The over-lifting smell:** If state is in a global store but only two sibling components use it, it's over-lifted. Move it to their parent.

**The under-lifting smell:** If the same API call is made by 3 separate components because they each manage their own copy of the data, it's under-lifted. Move to a shared cache.

### 5. Flow Report

```
FLOW: [component or feature name]
  State pieces:    [list each distinct piece of state]
  Flow direction:  [unidirectional / bidirectional / tangled]
  Violations:      [specific flow violations found]
  Mutation points: [how many places can mutate each piece of state?]
  State location:  [appropriate / over-lifted / under-lifted]
  Fix:             [specific changes to restore unidirectional flow]
```

Example:

```
FLOW: Shopping cart
  State pieces:    cart items, item count (derived), total price (derived), promo code, shipping estimate
  Flow direction:  bidirectional — CartItem component directly mutates cart store, header reads store
  Violations:      1) item count stored as independent state (should be derived from cart items)
                   2) CartItem component writes directly to cart store (should dispatch removeItem/updateQuantity actions)
                   3) promo code application triggers a useEffect that writes shipping estimate (cascade)
  Mutation points: cart items mutated from 3 components (CartItem, ProductPage, CartSidebar) — should be 1 reducer
  State location:  appropriate for cart (global store), over-lifted for promo code (only used in checkout)
  Fix:             1) derive item count and total as selectors, not stored state
                   2) CartItem dispatches actions, store reducer handles mutations
                   3) shipping estimate computed from cart + promo code in a single derivation, not cascading effects
                   4) move promo code to checkout-local state
```

## Interaction Model

Decision engine. After generating stateful UI code, the agent traces the data flow and checks for unidirectional violations. The report identifies specific flow breaks and concrete fixes. The human sees the analysis alongside the component code.

When the framework imposes specific patterns (e.g., React's controlled components require two-way data flow for form inputs), the agent distinguishes between framework-idiomatic bidirectionality (acceptable) and architectural bidirectionality (violation).

## Framework-Specific Guidance

**React** — useState for local, useReducer for complex local, Context for subtree, external store (Zustand/Redux) for global. Server state in TanStack Query/SWR. Never mutate state directly. Events via callbacks up, state via props down.

**Vue** — ref/reactive for local, Pinia for shared stores. v-model is controlled two-way binding (framework-idiomatic, not a violation). Watch/computed for derivations. Emits up, props down.

**Svelte** — $state for local, stores for shared. Bindings are two-way (framework-idiomatic). Derived with $derived. Events via dispatch/callbacks.

**Solid** — Signals for local, stores for complex, context for subtree. createMemo for derivations. Fine-grained reactivity means fewer re-render concerns, but flow direction still matters.

The unidirectional principle applies at the architectural level regardless of framework. Framework-level two-way binding (v-model, bind:) is a controlled, local pattern — not the same as architectural bidirectional state mutation.

## Guard Rails

**Don't fight the framework.** If Vue uses v-model for controlled inputs, that's not a flow violation — it's framework idiom. The enforcer checks architectural flow, not syntactic patterns.

**Not all state needs management.** A boolean toggling a dropdown doesn't need to be in a global store. Over-engineering state management is itself a violation of simplicity.

**Derived state is not state.** If a value can be computed from existing state, compute it. Don't store it. Stored derived state is a synchronization bug waiting to happen.

**Some bidirectionality is intentional.** Collaborative editing, optimistic updates, and real-time sync inherently involve bidirectional data flow. The enforcer should verify these are handled through explicit synchronization mechanisms (CRDTs, operational transforms), not through ad-hoc mutual mutation.

## The Elm Architecture (Reference)

```
Model ──→ View ──→ Message ──→ Update ──→ Model
  │                                        │
  └────────────────────────────────────────┘
```

1. **Model** — The single source of truth for application state
2. **View** — A pure function of the model (model → HTML). No side effects, no state mutation.
3. **Message** — A description of what happened (user clicked, data arrived). Not a command — a fact.
4. **Update** — The only place state changes. Takes (model, message) → new model. Pure function.

Every violation of unidirectional flow is a violation of one of these four boundaries.

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Storing derived state independently | Use selectors, computed properties, or memoization |
| Multiple components writing to the same state without coordination | Funnel all mutations through a single reducer/action |
| useEffect cascade (A changes → effect updates B → effect updates C) | Compute C from A directly; break the cascade chain |
| Passing setState through 4+ component layers | Use context or store subscription |
| Global store for component-local concerns | Keep local state local |
| Direct mutation of store state (e.g., `store.items.push(item)`) | Dispatch an action; let the store's update logic handle mutation |
