# magpie

Interactive Claude Code skill that runs a multi-stage PR review pipeline inside the user's Claude Code conversation.

## What it does

Given a GitHub PR number, dispatches five specialist subagents in parallel (security, bugs, performance, code-smells, architecture), dedupes their findings, applies a critic rubric, peer-reviews via `codex exec` (falling back to a Claude second-opinion subagent when codex is unavailable), serves an interactive HTML report, and posts the findings the user selects via `gh`.

## Requirements

- `bun` on PATH (https://bun.sh)
- `gh` on PATH, authenticated (`gh auth status`)
- `git` on PATH
- `codex` on PATH, authenticated (optional; if absent the peer-review stage falls back to a Claude second-opinion subagent)

## Install

```
bunx @iceinvein/agent-skills install magpie -g
```

This skill ships in two parts: the prompt (SKILL.md) and a companion Bun CLI (bin + scripts). The agent-skills installer writes both into `~/.claude/skills/magpie/` and then runs the bundled `install.sh` as a postinstall step, which symlinks `bin/magpie` onto your PATH (preferring `/usr/local/bin`, falling back to `~/.local/bin`). Removing the skill with `agent-skills remove magpie -g` runs `uninstall.sh` first to undo the PATH symlink.

If you cloned this repo and want to run from source, you can also invoke `./install.sh` directly: it does the PATH-link step against the local source tree.

## Use

Inside Claude Code, ask: "Review PR 1234" (or paste a PR URL). The agent reads SKILL.md and walks the pipeline; the CLI runs as `magpie setup`, `magpie serve`, etc.

## Development

```
bun install           # Installs @types/bun
bun test              # Run all tests
bun run lint          # Biome check
bun run typecheck     # tsc --noEmit
```

### Previewing the UI

Use the bundled example PR fixture to render either page without a real review. Useful for design iteration.

```
magpie preview                                  # render both pages, open findings.html
magpie preview --page progress --stage fresh    # progress page at "everything pending"
magpie preview --page progress --stage specialists-running
magpie preview --page progress --stage peer-review-error
magpie preview --no-open --out /tmp/magpie-ui   # write files only
magpie preview --list-stages                    # see all stage presets
```

The fixture lives at `fixtures/example-pr/` (pr.json + findings.final.json + post-status.json) and covers all four severities, all five focus domains, every section combination (with/without suggestion code block, with/without verification, raw-prose fallback), and a mix of posted / failed / fresh badges.

## Layout

- `SKILL.md` is the agent-facing prompt: the stage walkthrough and nothing else. Installed by the agent-skills CLI.
- `references/` holds the prompt bodies the walkthrough loads on demand, one file per stage that needs one: `specialists.md` (stage 3, the five focus blocks plus the shared output contract), `critic.md` (stage 5), `peer-review.md` (stage 6, including the Claude-fallback preamble). They ship in the bundle and sit next to `SKILL.md` once installed.
- `skill.json` is the agent-skills manifest.
- `bin/magpie` is the CLI invoked by the agent during stages; symlinked onto PATH by `install.sh`.
- `scripts/` holds the implementation (server, dedupe, render, setup, cleanup, etc.).
- `templates/styles.css` is the HTML report stylesheet.
- `fixtures/` holds canned PR data; `fixtures/example-pr/` ships with the bundle (it powers `magpie preview`), the rest exists for tests.
- `install.sh` is run as a postinstall step by the agent-skills installer; symlinks `bin/magpie` onto PATH and records the location.
- `uninstall.sh` is run as a postremove step; removes the PATH symlink if it still points back into this bundle.


## Run directory layout

Each invocation creates `~/.magpie/pr-<n>-<ts>/` with `pr.json`, `diff.patch`, `findings/`, `findings.deduped.json`, `findings.kept.json`, `findings.final.json`, `screen/`, `state/`, `log.jsonl`. On completion the directory is renamed to `<run-dir>.archived-<timestamp>` rather than deleted, so logs survive for postmortem.
