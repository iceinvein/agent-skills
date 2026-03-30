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
