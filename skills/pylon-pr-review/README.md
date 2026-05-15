# pylon-pr-review

Interactive Claude Code skill that runs a multi-stage PR review pipeline inside the user's Claude Code conversation. Originally extracted from the Pylon desktop app.

## What it does

Given a GitHub PR number, dispatches five specialist subagents in parallel (security, bugs, performance, code-smells, architecture), dedupes their findings, applies a critic rubric, peer-reviews via `codex exec`, serves an interactive HTML report, and posts the findings the user selects via `gh`.

## Requirements

- `bun` on PATH (https://bun.sh)
- `gh` on PATH, authenticated (`gh auth status`)
- `codex` on PATH, authenticated
- `git` on PATH

## Install

This skill ships in two parts: the prompt (SKILL.md) and a companion Bun CLI (bin + scripts). Both are needed.

**1. Install the prompt via agent-skills:**

```
bunx @iceinvein/agent-skills install pylon-pr-review
```

That copies SKILL.md to `.claude/skills/pylon-pr-review/SKILL.md` (or `~/.claude/skills/...` with `-g`).

**2. Install the CLI from this directory:**

```
./install.sh
```

That symlinks the full skill source tree (bin/, scripts/, templates/, fixtures/) into `~/.claude/skills/pylon-pr-review/`, so the prompt and the CLI live together. Run it from this directory (the source path the symlink points at). Re-running is safe; it updates the symlink.

## Use

Inside Claude Code, ask: "Review PR 1234" (or paste a PR URL). The agent reads SKILL.md and walks the pipeline; the CLI runs as `pr-review setup`, `pr-review serve`, etc.

## Development

```
bun install           # Installs @types/bun
bun test              # Run all tests (62 tests, 19 files)
bun run lint          # Biome check
bun run typecheck     # tsc --noEmit
```

## Layout

- `SKILL.md` is the agent-facing prompt; installed by the agent-skills CLI.
- `skill.json` is the agent-skills manifest.
- `bin/pr-review` is the CLI invoked by the agent during stages; installed by `install.sh`.
- `scripts/` holds the implementation (server, dedupe, render, setup, cleanup, etc.).
- `templates/styles.css` is the HTML report stylesheet.
- `fixtures/` holds canned PR data for tests.
- `install.sh` symlinks the skill directory into `~/.claude/skills/`.

## Design docs

The original design and implementation plan live at `docs/pylon-pr-review/design.md` and `docs/pylon-pr-review/plan.md` at the repo root.

## Run directory layout

Each invocation creates `~/.pylon-review/pr-<n>-<ts>/` with `pr.json`, `diff.patch`, `findings/`, `findings.deduped.json`, `findings.kept.json`, `findings.final.json`, `screen/`, `state/`, `log.jsonl`. On completion the directory is renamed to `<run-dir>.archived-<timestamp>` rather than deleted, so logs survive for postmortem.
