# @iceinvein/agent-skills

Install agent skills into AI coding tools — Claude Code, Cursor, Codex, Gemini CLI.

## Quick Start

```bash
# Install a skill (auto-detects your tools)
npx @iceinvein/agent-skills install design-review

# Install for a specific tool
npx @iceinvein/agent-skills install design-review --tool claude
```

## Commands

| Command | Description |
|---------|-------------|
| `install <skill> [--tool <tool>]` | Install a skill |
| `remove <skill>` | Remove a skill |
| `update <skill>` | Update to latest version |
| `list` | List all available skills |
| `info <skill>` | Show skill details |

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

A `.agent-skills.lock` file tracks installations for update and remove.

## License

MIT
