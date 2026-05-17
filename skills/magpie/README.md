# magpie

Interactive Claude Code skill that runs a multi-stage PR review pipeline inside the user's Claude Code conversation.

## What it does

Given a GitHub PR number, dispatches five specialist subagents in parallel (security, bugs, performance, code-smells, architecture), dedupes their findings, applies a critic rubric, peer-reviews via `codex exec`, serves an interactive HTML report, and posts the findings the user selects via `gh`.

## Requirements

- `bun` on PATH (https://bun.sh)
- `gh` on PATH, authenticated (`gh auth status`)
- `codex` on PATH, authenticated
- `git` on PATH

## Install

This skill ships in two parts: the prompt (SKILL.md) and a companion Bun CLI (bin + scripts). Both are needed, and `install.sh` handles both in one step.

```
./install.sh
```

That symlinks the full skill source tree (bin/, scripts/, templates/, fixtures/, SKILL.md, skill.json) into `~/.claude/skills/magpie/`, then symlinks `bin/magpie` onto your PATH (preferring `/usr/local/bin`, falling back to `~/.local/bin`). Re-run any time to refresh the links.

Once an agent-skills registry entry exists for `magpie`, the prompt half can also be installed via `bunx @iceinvein/agent-skills install magpie`, but the CLI still requires `./install.sh` (or an equivalent manual symlink) because the registry only ships SKILL.md.

## Use

Inside Claude Code, ask: "Review PR 1234" (or paste a PR URL). The agent reads SKILL.md and walks the pipeline; the CLI runs as `magpie setup`, `magpie serve`, etc.

## Development

```
bun install           # Installs @types/bun
bun test              # Run all tests (145 tests, 24 files)
bun run lint          # Biome check
bun run typecheck     # tsc --noEmit
```

## Layout

- `SKILL.md` is the agent-facing prompt; installed by the agent-skills CLI.
- `skill.json` is the agent-skills manifest.
- `bin/magpie` is the CLI invoked by the agent during stages; installed by `install.sh`.
- `scripts/` holds the implementation (server, dedupe, render, setup, cleanup, etc.).
- `templates/styles.css` is the HTML report stylesheet.
- `fixtures/` holds canned PR data for tests.
- `install.sh` symlinks the skill directory into `~/.claude/skills/`.

## Design docs

The original design and implementation plan live at `docs/magpie/design.md` and `docs/magpie/plan.md` at the repo root.

## Run directory layout

Each invocation creates `~/.magpie/pr-<n>-<ts>/` with `pr.json`, `diff.patch`, `findings/`, `findings.deduped.json`, `findings.kept.json`, `findings.final.json`, `screen/`, `state/`, `log.jsonl`. On completion the directory is renamed to `<run-dir>.archived-<timestamp>` rather than deleted, so logs survive for postmortem.
