# Catalogue fields for improve-my-codebase

The `improve-my-codebase` orchestrator reads `skills/index.json` and routes audits based on two fields:

## `applies: string[]`

Areas a skill is relevant to. The orchestrator runs an audit only when at least one of its `applies` values matches a detected stack signal (or `any`).

| Value | Meaning | Detection signal |
|-------|---------|------------------|
| `any` | Always applicable | Always matches |
| `ui` | Requires UI surface | `.tsx`/`.jsx`/`.vue`/`.svelte`/`.html`/`.css` files, or `react`/`vue`/`svelte`/`solid` in `package.json` deps |
| `domain` | Requires domain layer | Directory named `domain/`, `entities/`, `aggregates/`, or domain-driven naming |
| `integration` | Requires messaging/events | Directory named `events/`, `messaging/`, `queues/`, or deps `kafkajs`/`amqplib`/`bullmq` |
| `architecture` | Cross-cutting structural | Always matches in projects with > 5 files |
| `errors` | Error handling concerns | Always matches in any non-trivial codebase |
| `legacy` | Modifying existing code | Only fires when invoked with `diff` mode |

## `quick: boolean`

Whether the audit qualifies for the `quick` mode. Quick audits should:
- Be primarily structural or static (file structure, imports, naming).
- Avoid deep semantic reasoning over function bodies.
- Return findings within roughly 60 seconds on a medium repo.

If unsure, mark `quick: false`. Better to miss in quick mode than to blow the latency budget.
