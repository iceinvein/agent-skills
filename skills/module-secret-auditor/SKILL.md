---
name: module-secret-auditor
description: Use when creating new files, directories, or modules, when reviewing project structure, when a change ripples across 3+ directories, or when the user asks "where should this code live?" or "how should I structure this?". Trigger on structural decisions and reorganizations.
---

# Module Secret Auditor

A structural analysis framework based on David Parnas' information hiding principle. Every module should hide exactly one design decision that is likely to change. Module boundaries exist to isolate the impact of change — not to group related nouns or match technical layers.

**Core principle:** The question isn't "what is this module?" but "what secret does this module hide?" If you can't name the secret, the boundary is wrong.

## When to Use

- Creating new files, directories, or modules
- Reviewing or questioning existing project structure
- A change to one feature requires modifying files in 3+ directories
- "Where should this code live?" / "How should I structure this?"
- Proposing a refactoring that reorganizes code
- Post-mortem on a change that rippled further than expected

**Not for:** Naming conventions, code style, adding code to existing well-bounded modules, or trivial file organization (moving a constant).

## The Process

### 1. Identify the Secrets

For each module (file, directory, package), answer: **"What design decision does this module hide from the rest of the system?"**

**Good secrets** (specific, likely to change):
- "How authentication tokens are validated and refreshed"
- "The algorithm for calculating shipping costs"
- "How we communicate with the payment provider's API"
- "The format and schema of the analytics event payload"

**Bad secrets** (vague, organized by noun or layer):
- "All the models" — grouped by technical role, not by change-reason
- "Utility functions" — no shared secret, just a junk drawer
- "Things related to users" — too broad. Which *decision* about users?
- "The controller layer" — a technical layer isn't a secret

If you can't name the secret in one specific sentence, the module is hiding nothing — or hiding too many things.

### 2. One Change, One Module Test

For each likely change the system will face, trace the blast radius:

1. Name the change: "We switch from Stripe to a different payment provider"
2. List every module that must be modified
3. If > 1 module must change for a single business decision, the secret is leaked

Run this test for 3-5 realistic changes. The changes that matter most are the ones the human identifies as likely — ask them:

> "What are the things most likely to change in this system over the next 6 months?"

This is domain knowledge the code doesn't reveal. Without it, you're guessing at change-likelihood based on patterns.

### 3. Leak Detection

Scan for information hiding violations — places where a module's internal decisions are visible to the outside:

- **Exported internals:** A module exports data structures that encode its implementation choices (e.g., a database module exports raw row types instead of domain types)
- **Caller knowledge:** A caller must understand the internal state machine or initialization order of another module to use it correctly
- **Configuration leaks:** File formats, protocol details, or algorithm parameters visible across module boundaries
- **Connector types:** Types that exist solely to shuttle data between modules that should be independent — these are often symptoms of a missing or misdrawn boundary

### 4. Recommend by Secret

When proposing structure, organize around change-reasons, not around nouns or technical layers.

Instead of:
```
models/user.ts
services/userService.ts
controllers/userController.ts
repositories/userRepository.ts
```

Propose:
```
auth/               — secret: how identity is verified and sessions are managed
pricing/            — secret: how costs are calculated and discounts applied
notifications/      — secret: how and when users are notified, via which channels
```

Each directory answers: **"If this decision changes, only this directory is affected."**

This doesn't mean you can't have shared infrastructure (database client, HTTP framework, logging). Infrastructure modules hide *infrastructure secrets* — "how we talk to Postgres" or "how we structure HTTP responses." The test still applies: when the infrastructure decision changes, only the infrastructure module changes.

## Interaction Model

The agent analyzes code structure independently but must ask the human one critical question:

> "What are the things most likely to change in this system over the next 6 months?"

This determines what the secrets should be. The agent can assess *structural* quality on its own (leak detection, coupling analysis), but *change-likelihood* is a domain judgment.

If the human isn't sure, offer concrete prompts:
- "Will you likely switch any external services (payment, email, auth provider)?"
- "Are there business rules that are still being figured out?"
- "Is there a part of the system that gets changed every sprint?"

## Output Format

```
MODULE AUDIT: [module or directory name]
  Secret:     [the design decision this module hides — one sentence]
  Leak check: [leaked? where does the secret escape?]
  Change test: [for the most likely change — how many modules would be affected?]
  Verdict:    [well-bounded / leaking / misdrawn / no clear secret]
```

## The Parnas Litmus Tests (Reference)

| Question | Good answer | Bad answer |
|----------|-------------|------------|
| What secret does this module hide? | A specific design decision | "User-related things" |
| If the secret changes, what else breaks? | Nothing outside this module | Multiple other modules |
| Can you describe the module's interface without revealing the secret? | Yes — the interface is abstract | No — callers need to know internals |
| Why are these two things in the same module? | They share a secret | They share a noun |
| Why are these two things in different modules? | They hide different secrets | They're in different technical layers |

## Guard Rails

**Don't reorganize for its own sake.** If the current structure works and changes don't ripple, the boundaries are fine — even if they don't match textbook information hiding. Parnas' principle is a tool for evaluating structure, not a mandate to restructure everything.

**Respect team conventions.** If the team uses MVC and it's working, don't unilaterally propose feature-based organization. Present the analysis and let the team decide.

**Infrastructure is a valid secret.** "How we talk to the database" is a real secret that deserves its own module. Not everything needs to be a business domain boundary.

**Small projects get simple boundaries.** A 10-file project doesn't need 10 modules with formal interfaces. The secret principle scales — apply it at whatever granularity fits the codebase.

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Organizing by technical layer (models/, services/, controllers/) | Organize by change-reason. Ask: "what secret does each layer hide?" |
| Creating a module per entity (UserModule, OrderModule, ProductModule) | Entities aren't secrets. Ask: "which *decisions* about users change independently?" |
| "Utils" or "shared" directories | Each utility should live near its caller. If two callers need it, that's a signal of a shared secret — name it. |
| Assuming current structure is wrong | Always evaluate before prescribing. Working code with imperfect boundaries beats reorganized code that breaks. |
| Ignoring the human's change-likelihood input | Domain knowledge trumps structural analysis. If the human says "pricing never changes," don't optimize for pricing changes. |
