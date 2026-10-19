# Plugin marketplace install

## Goal

Make every Claude Code skill in this repo installable through Claude Code's
plugin marketplace, alongside the existing `bunx @iceinvein/agent-skills`
CLI, with the same behaviour a bunx install gives. One plugin per skill.

```
/plugin marketplace add iceinvein/agent-skills
/plugin install sluice@iceinvein-skills
```

## Decisions already made

- One plugin per skill (not one bundle, not categories).
- Full parity for the skills that need more than a folder copy.

## Shape

### Marketplace file

`.claude-plugin/marketplace.json` at the repo root, generated, never hand
edited. Marketplace name `iceinvein-skills`: `agent-skills` is reserved by
Claude Code.

Each skill whose `skill.json` lists `claude` in `tools` gets one entry:

```json
{
  "name": "sluice",
  "source": "./skills/sluice",
  "description": "<skill.json description>",
  "version": "<skill.json version>",
  "author": { "name": "<skill.json author>" },
  "hooks": { ... only for activation.default == "global" ... }
}
```

`source` points at the skill directory itself, so the skill dir is the plugin
root. No files move, and the bunx CLI keeps reading the same tree. A plugin
root holding `SKILL.md` loads as one skill. `agents/` and `bin/` under it are
picked up by Claude Code's default locations. Entries carry no `plugin.json`,
so the marketplace entry is the whole manifest.

`version` comes from `skill.json`, so the existing per-skill bump is what
ships an update to plugin users. Nothing new to remember at release. The one
exception is improve-my-codebase (see Audits below).

### Generator

`scripts/build-index.ts` already turns every `skill.json` into
`skills/index.json`, and `release.sh` refuses to release while that file is
stale. The marketplace comes from the same inputs, so the same script writes
it, and `release.sh` checks it for staleness the same way. A separate script
would be a second command to forget.

### Hooks (sluice)

Plugin hooks have no session/global switch: an enabled plugin's hooks always
run. The generator follows each skill's `activation.default`:

- `global` (sluice): the entry gets inline hooks.
  - `SessionStart`: `echo '<claudeHookDirective>'; bash "${CLAUDE_PLUGIN_ROOT}/scripts/session-start.sh"`
  - `Stop`: `bash "${CLAUDE_PLUGIN_ROOT}/scripts/stop-guard.sh"`
- `session` (terse): no hooks. Plugin users invoke `/terse:terse` like a
  session-mode bunx user. Turning terse on for every session is a bigger
  change than an install route should make silently.

The scripts already locate their siblings with `dirname "$0"` and keep runtime
state under `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/sluice`. They need no change.

### Statusline (sluice): not reachable

A plugin cannot set `statusLine`. The script also sits in a versioned cache
directory, so no stable path exists to paste either. Under a plugin install
the sluice statusline segment is unavailable. `status.sh show` and the
SessionStart hook still report a live run. README says so. This is the one
gap the platform forces. It is not a stub.

### Agent (sluice)

`skills/sluice/agents/sluice-implementer-low.md` loads from the plugin's
`agents/`, where Claude Code namespaces it `sluice:sluice-implementer-low`.
`references/deep-channel.md` names the bare type in two places. Both gain the
namespaced form as the one to use under a plugin install.

### CLIs (magpie, migrate)

A plugin's `bin/` goes on the Bash tool's `PATH`, and both skills already
ship `bin/magpie` and `bin/migrate` as wrappers that `exec bun <name>.ts`. So
the bare `magpie ...` / `migrate ...` calls in their SKILL.md files work
unchanged. `install.sh` and `uninstall.sh` do not run and are not needed:
there is no symlink to place or remove.

Magpie also needs `node_modules` (shiki), which git does not carry, and
nothing runs `install.sh`. (The bug hunt found that Claude Code 2.1.303's
`plugin install` installs a plugin's `package.json` dependencies itself; the
wrapper's install is then a fallback, kept for versions and setups where that
does not happen.) `bin/magpie` installs
production dependencies on first run when `node_modules` is missing, the same
`bun install --production` that `install.sh` runs. Under bunx, `install.sh`
has already done it, so the check is a no-op. A plugin update lands in a fresh
cache directory and installs again on its first run. Migrate has no
dependencies.

Migrate's SKILL.md says the CLI is "put there by this skill's `install.sh`".
That line is reworded to cover both routes.

### Audits (improve-my-codebase)

improve-my-codebase reads its audits from sibling skill directories
(`<skills-root>/<audit-id>/SKILL.md`). A plugin copy holds only its own
directory, so every audit would read as not installed. Its `skill.json`
carries `"plugin": { "bundleSiblings": true }`, and the generator gives that
entry `source: "./skills"` with `skills: ["./improve-my-codebase"]`. The
plugin copy then carries every audit as plain files, while only
improve-my-codebase loads as a skill. The entry has no `version`, so Claude
Code versions it by the repo's HEAD commit. Any commit offers an update,
including one that touched no audit. A pinned version would freeze
the audit copies until improve-my-codebase itself was bumped. (Found by the
final review; partner chose this over teaching the skill the cache layout or
documenting a limitation.)

### Paths in skill docs

- `scope-estimate/SKILL.md:134` hardcodes `.claude/skills/scope-estimate/...`
  and tells the reader to swap in `~/.claude` when the skill is global. It
  becomes `<skill-dir>/scripts/schedule.ts`, where `<skill-dir>` is the skill's
  base directory. That is the convention sluice already uses, and the harness
  states the base directory when the skill loads, under either install route.
- sluice's `references/status.md:386` hardcodes the global bunx statusline
  path. It is left alone because it documents the bunx route. The plugin
  route's absence of a statusline goes in README.

### README

The Install section gains a "Claude Code plugin" route next to bunx:

- the two commands
- skills invoke as `/<skill>:<skill>` (for example `/sluice:sluice`)
- updates come through `/plugin` (third-party marketplaces do not auto-update
  by default)
- installing a hook-carrying skill (sluice) through both routes runs its hooks
  twice, so pick one
- sluice's statusline is bunx-only
- magpie and migrate need Bun on PATH, as they do under bunx

## Verification

- Generator tests: given fixture `skill.json` inputs, the marketplace output
  has one entry per Claude skill, skips non-Claude skills, carries
  version/description, and adds hooks only for `activation.default: global`.
  Expected JSON written by hand.
- `claude plugin validate . --strict` on the marketplace. Not on each
  `skills/<name>`: the validator requires a `plugin.json` in the directory,
  which this design deliberately does not have. The isolated install below is
  the check for the plugins.
- Integration: with `CLAUDE_CONFIG_DIR` pointed at a scratch dir, add this
  checkout as a local marketplace, install sluice, magpie and a plain skill,
  then:
  - check `claude plugin details` lists the skill, agent and hooks
  - run `bin/magpie --help` from the installed cache copy, so the dependency
    bootstrap is exercised
- `bun test` green.

## Out of scope

- Changing the bunx CLI.
- Cursor, Codex and Gemini: plugins are Claude Code only.
