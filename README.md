# @iceinvein/agent-skills

[![npm version](https://img.shields.io/npm/v/@iceinvein/agent-skills)](https://www.npmjs.com/package/@iceinvein/agent-skills)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Claude Code](https://img.shields.io/badge/Claude_Code-supported-blueviolet)](https://claude.ai/code)
[![Cursor](https://img.shields.io/badge/Cursor-supported-blue)](https://cursor.com)
[![Codex](https://img.shields.io/badge/Codex-supported-green)](https://openai.com/codex)
[![Gemini CLI](https://img.shields.io/badge/Gemini_CLI-supported-orange)](https://github.com/google-gemini/gemini-cli)

Thinking frameworks from foundational software engineering texts — installed as skills for AI coding agents.

Each skill encodes a specific design methodology (Brooks, Parnas, Rams, Feathers, etc.) so your agent doesn't just write code — it reasons about structure, coupling, complexity, and perception the way these authors taught us to.

## Install

Requires [Bun](https://bun.sh). Install it with `curl -fsSL https://bun.sh/install | bash`.

```bash
bunx @iceinvein/agent-skills install <skill>
```

Auto-detects Claude Code, Cursor, Codex, or Gemini CLI. Use `--tool claude` to target one, `-g` to install globally.

## Skills

### Code Architecture

Skills that analyze how code is structured — module boundaries, coupling, complexity, contracts, and evolution over time.

| Skill | Based on | What it does |
|-------|----------|--------------|
| **complexity-accountant** | Ousterhout, *A Philosophy of Software Design* | Treats complexity as a finite budget. Every abstraction must justify itself by being deep (simple interface, rich functionality), not shallow. |
| **contract-enforcer** | Meyer, *Object-Oriented Software Construction* | Before writing non-trivial functions, articulates preconditions, postconditions, invariants, and failure contracts — then verifies the implementation satisfies them. |
| **module-secret-auditor** | Parnas, *On the Criteria for Decomposing Systems into Modules* | Every module should hide exactly one design decision that's likely to change. Boundaries drawn by change-reason, not by noun or technical layer. |
| **coupling-auditor** | Constantine & Yourdon, *Structured Design* | Classifies coupling between modules on the spectrum (data > stamp > control > common > content) and recommends one step down. |
| **simplicity-razor** | Hickey, *Simple Made Easy* | Distinguishes simple (not interleaved) from easy (familiar). Names the strands, detects complecting, and decomplects or justifies. |
| **error-strategist** | Duffy & Abrahams | Classifies errors (bug/recoverable/fatal), assigns exception safety guarantees (nothrow/strong/basic), and designs recovery boundaries. |
| **seam-finder** | Feathers, *Working Effectively with Legacy Code* | Before changing existing code, finds seams — places where behavior can be altered without editing the code at that point. Minimal incision, preserve the unknown. |
| **evolution-analyzer** | Lehman, *Laws of Software Evolution* | Evaluates changes through the Laws of Software Evolution — assessing trajectory, debt impact, and whether the system is adapting or accreting. |
| **cohesion-analyzer** | Constantine & Yourdon, *Structured Design* | Classifies module focus on the 7-level cohesion spectrum (coincidental → functional), identifies mixed responsibilities, and proposes specific split lines. |
| **demeter-enforcer** | Lieberherr, *Law of Demeter* | Detects chain violations, parameter drilling, and hidden traversal. Fixes with "tell, don't ask" or parameter narrowing to reduce structural coupling. |
| **dependency-direction-auditor** | Martin, *Clean Architecture* | Traces imports across architectural layers, classifies direction violations by severity (hard/soft/transitive), and recommends specific inversions. |
| **type-driven-designer** | Wlaschin, *Domain Modeling Made Functional*; Minsky, "Make Illegal States Unrepresentable" | Uses the type system to encode business rules — branded types for validated values, discriminated unions for state machines, elimination of primitive obsession. |
| **cqs-auditor** | Meyer, *Object-Oriented Software Construction* | Classifies functions as commands (change state) or queries (return data), detects mixed violations, and separates side effects from return values. |

### UI & Visual Design

Skills that evaluate interfaces through perception, cognition, and design principles.

| Skill | Based on | What it does |
|-------|----------|--------------|
| **rams-design-audit** | Dieter Rams, *Ten Principles of Good Design* | Every visual element must earn its presence — if removing it loses nothing, remove it. Less but better. |
| **cognitive-load-auditor** | Jeff Johnson, *Designing with the Mind in Mind* | Evaluates UI against Miller's Law (working memory), Hick's Law (decision time), Fitts's Law (target size), and cognitive load theory. |
| **gestalt-reviewer** | Gestalt psychology | Checks that visual grouping matches logical grouping through proximity, similarity, closure, continuity, and figure-ground analysis. |

### System Design & Integration

Skills for reviewing high-level architecture, messaging patterns, and data flow.

| Skill | Based on | What it does |
|-------|----------|--------------|
| **design-review** | Brooks, *The Design of Design* | Interactive interview that tests conceptual integrity, constraint exploitation, removal discipline, and scope control. |
| **codebase-architecture** | — | Architecture review for existing codebases or structured design for new projects. Includes a comprehensive patterns reference. |
| **integration-pattern-auditor** | Hohpe & Woolf, *Enterprise Integration Patterns* | Names the integration pattern (channel, router, transformer, endpoint), verifies delivery guarantees, and identifies missing infrastructure like dead letter queues and idempotency. |
| **unidirectional-flow-enforcer** | Elm Architecture | Enforces unidirectional state flow in UI applications — events up, state down, mutations in one place. Detects bidirectional mutations and cascading effects. |
| **event-design-reviewer** | Evans, Vernon, Dahan (DDD) | Events should describe what happened in the domain, not what changed in the database. Applies the domain expert test, evaluates payload design, and catches CRUD naming smells. |
| **bounded-context-auditor** | Evans, *Domain-Driven Design* | Detects linguistic fractures (polysemous terms, contested models), draws context maps with relationship types, and identifies leaking language and shared model pollution. |
| **port-adapter-auditor** | Cockburn, *Hexagonal Architecture* | Maps driving and driven ports, classifies boundary health (clean/missing/leaking/wrong-language), and ensures core testability and infrastructure swappability. |
| **idempotency-guardian** | Helland, *Idempotence Is Not a Medical Condition* | Audits mutation endpoints and event handlers for retry safety — classifies natural idempotency, checks protection mechanisms, and evaluates side effect safety. |
| **composability-auditor** | McIlroy, Pike, Thompson — Unix Philosophy | Identifies reuse blockers (hidden I/O, non-standard interfaces, statefulness) and decomposes self-sufficient units into composable pieces. |
| **temporal-coupling-detector** | Beck, Fowler — software engineering canon | Detects hidden ordering dependencies (two-phase init, method order, invisible preconditions) and enforces them through types, parameters, and factory patterns. |

### Communication

Skills that control how the agent communicates — output compression, token efficiency, and response style.

| Skill | Based on | What it does |
|-------|----------|--------------|
| **terse** | Caveman (refined) | Professional output compression — cuts ~50-60% of tokens by eliminating LLM verbosity habits (preambles, hedging, trailing summaries) while keeping proper grammar. Three levels: clean, tight, sharp. |

### Career & Writing

Skills for producing job application materials that read like a human wrote them, match the role, and align with the resume.

| Skill | Role | What it does |
|-------|------|--------------|
| **cover-letter** | Suite router | Dispatches to write, audit, rewrite, or persona subcommands. Shares conventions for file I/O (PDF, DOCX, MD/MDX, URL), output formats, and writing principles across the suite. |
| **cover-letter-write** | Generator | Generates a cover letter from resume + job description. Outputs markdown, DOCX, and PDF. Enforces human prose (burstiness, concrete verbs, no filler openers), maps every claim to a resume bullet, and covers top JD requirements without keyword stuffing. |
| **cover-letter-audit** | Scorer | Scores a letter on 100 points across content/fit, structure, voice/humanness, and correctness. Detects AI-generated-content signals (burstiness, 50+ AI phrases including sentimental cliches, TTR, em-dashes, passive voice) and produces prioritized fixes. |
| **cover-letter-rewrite** | Reviser | Audit-driven targeted rewrite of an existing letter. Focus modes: humanize, align, tighten, structure, tone. Preserves voice where it already works. |
| **cover-letter-persona** | Voice profile | Reusable writing personas using the NNGroup 4-dimension tone framework (funny-serious, formal-casual, respectful-irreverent, enthusiastic-matter-of-fact) adapted for professional correspondence. |

### Tooling

| Skill | Type | What it does |
|-------|------|--------------|
| **code-intelligence** | MCP server | Semantic code search, call hierarchy, dependency graphs, and impact analysis. Powered by `@iceinvein/code-intelligence-mcp`. |

### Orchestration

Skills that compose the other audit skills into higher-level workflows.

| Skill | What it does |
|-------|--------------|
| **improve-my-codebase** | Runs every applicable audit skill in parallel against your codebase, ranks findings by convergence (multiple audits agreeing) and per-file rollup, and writes a prioritized improvement report. Default sweeps everything; positional args switch modes (`quick`, `diff`, `interactive`) or narrow scope (`focus <area>`, `module <path>`). |

## Commands

```
bunx @iceinvein/agent-skills install <skill> [--tool <tool>] [--activation <mode>] [-g]
bunx @iceinvein/agent-skills remove <skill> [-g]
bunx @iceinvein/agent-skills update <skill> [-g]
bunx @iceinvein/agent-skills list
bunx @iceinvein/agent-skills info <skill>
```

| Flag | |
|------|---|
| `--tool <tool>` | Target a specific tool: `claude`, `cursor`, `codex`, `gemini` |
| `--activation <mode>` | For skills that support it: `session` (manual `/skill`) or `global` (auto via `SessionStart` hook). Claude Code only. |
| `-g, --global` | Install to home directory (available in all projects) |

## Activation Modes (Claude Code)

Some skills — like `terse` — support activation modes. Pick one at install time:

- **session** (default) — invoke the skill manually with `/<skill>` each session
- **global** — auto-activate every Claude Code session via a `SessionStart` hook in `.claude/settings.json`

If a skill declares activation support and you're installing for Claude Code interactively, the CLI prompts you. Use `--activation session` or `--activation global` for scripted installs. `remove` strips the hook cleanly; `update` preserves your choice across version bumps.

## Supported Tools

| Tool | Prompt Skills | MCP Skills |
|------|:---:|:---:|
| Claude Code | Yes | Yes |
| Cursor | Yes | Yes |
| Codex | Yes | — |
| Gemini CLI | Yes | Yes |

## How It Works

The CLI fetches skills from GitHub and installs them into the right locations for your tool:

| Tool | Install path |
|------|-------------|
| Claude Code | `.claude/skills/` + `.claude/settings.json` |
| Cursor | `.cursor/rules/` + `.cursor/mcp.json` |
| Codex | Appended to `AGENTS.md` |
| Gemini CLI | `.gemini/skills/` + `.gemini/settings.json` |

Skills install to the **current project** by default. Use `-g` to install to your **home directory** so the skill is available everywhere. A `.agent-skills.lock` file tracks installations for update and remove.

## License

MIT
