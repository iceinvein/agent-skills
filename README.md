# @iceinvein/agent-skills

[![npm version](https://img.shields.io/npm/v/@iceinvein/agent-skills)](https://www.npmjs.com/package/@iceinvein/agent-skills)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Claude Code](https://img.shields.io/badge/Claude_Code-supported-blueviolet)](https://claude.ai/code)
[![Cursor](https://img.shields.io/badge/Cursor-supported-blue)](https://cursor.com)
[![Codex](https://img.shields.io/badge/Codex-supported-green)](https://openai.com/codex)
[![Gemini CLI](https://img.shields.io/badge/Gemini_CLI-supported-orange)](https://github.com/google-gemini/gemini-cli)

Install agent skills into AI coding tools — Claude Code, Cursor, Codex, Gemini CLI.

## Prerequisites

[Bun](https://bun.sh) is required. Install it with:

```bash
curl -fsSL https://bun.sh/install | bash
```

## Quick Start

```bash
# Install a skill (auto-detects your tools)
bunx @iceinvein/agent-skills install design-review

# Install for a specific tool
bunx @iceinvein/agent-skills install design-review --tool claude

# Install globally (available in all projects)
bunx @iceinvein/agent-skills install design-review -g
```

If no tools are detected in your directory, the CLI will prompt you to choose which tools you use.

## Commands

| Command | Description |
|---------|-------------|
| `install <skill> [--tool <tool>] [-g]` | Install a skill |
| `remove <skill> [-g]` | Remove a skill |
| `update <skill> [-g]` | Update to latest version |
| `list` | List all available skills |
| `info <skill>` | Show skill details |

### Flags

| Flag | Description |
|------|-------------|
| `--tool <tool>` | Install for a specific tool (claude, cursor, codex, gemini) |
| `-g, --global` | Install to home directory instead of current project |

## Available Skills

### design-review
Brooks-inspired design integrity review. Interactive interview that tests conceptual integrity, constraint exploitation, removal discipline, and scope control.

### codebase-architecture
Architecture review for existing codebases or structured design for new projects. Includes a comprehensive patterns reference.

### code-intelligence
Semantic code search, call hierarchy, dependency graphs, and impact analysis. MCP server powered by `@iceinvein/code-intelligence-mcp`.

### contract-enforcer
Meyer-inspired Design by Contract. Before writing non-trivial functions, articulates preconditions, postconditions, invariants, and failure contracts — then verifies the implementation satisfies them.

### complexity-accountant
Ousterhout-inspired complexity analysis. Treats complexity as a finite budget — every abstraction must justify itself by being deep (simple interface, rich functionality), not shallow.

### module-secret-auditor
Parnas-inspired information hiding. Every module should hide exactly one design decision that's likely to change. Boundaries drawn by change-reason, not by noun or technical layer.

### seam-finder
Feathers-inspired legacy code modification. Before changing existing code, finds seams — places where behavior can be altered without editing the code at that point. Minimal incision, preserve the unknown.

### simplicity-razor
Hickey-inspired simplicity analysis. Distinguishes simple (not interleaved) from easy (familiar). Names the strands, detects complecting, and decomplects or justifies.

### coupling-auditor
Constantine & Yourdon-inspired coupling analysis. Classifies coupling between modules on the spectrum (data → stamp → control → common → content) and recommends one step down.

### evolution-analyzer
Lehman-inspired software evolution analysis. Evaluates changes through the Laws of Software Evolution — assessing trajectory, debt impact, and whether the system is adapting or accreting.

### error-strategist
Duffy & Abrahams-inspired error handling. Classifies errors (bug/recoverable/fatal), assigns exception safety guarantees (nothrow/strong/basic), and designs recovery boundaries.

### rams-design-audit
Dieter Rams-inspired design audit. Every visual element must earn its presence — if removing it loses nothing, remove it. Evaluates UI against the ten principles of good design.

### cognitive-load-auditor
Jeff Johnson-inspired cognitive load analysis. Evaluates UI against Miller's Law (working memory), Hick's Law (decision time), Fitts's Law (target size), and cognitive load theory.

### gestalt-reviewer
Gestalt-inspired visual perception audit. Checks that visual grouping matches logical grouping through proximity, similarity, closure, continuity, and figure-ground analysis.

## Supported Tools

| Tool | Prompt Skills | MCP/Code Skills |
|------|:---:|:---:|
| Claude Code | Yes | Yes |
| Cursor | Yes | Yes |
| Codex | Yes | — |
| Gemini CLI | Yes | Yes |

## How It Works

Skills live in this repo under `skills/`. The CLI fetches them from GitHub and installs them into the right locations for your tool:

- **Claude Code**: `.claude/skills/` + `.claude/settings.json`
- **Cursor**: `.cursor/rules/` + `.cursor/mcp.json`
- **Codex**: Appended to `AGENTS.md`
- **Gemini CLI**: `.gemini/skills/` + `.gemini/settings.json`

### Local vs Global

By default, skills install to the **current project directory** (e.g., `./claude/skills/`). Use `-g` to install to your **home directory** (e.g., `~/.claude/skills/`) so the skill is available in every project.

A `.agent-skills.lock` file tracks installations for update and remove.

## License

MIT
