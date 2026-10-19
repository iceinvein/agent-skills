# Plan: plugin marketplace

**Goal:** every Claude Code skill in this repo installs through
`/plugin marketplace add iceinvein/agent-skills` +
`/plugin install <skill>@iceinvein-skills`, with bunx parity. Design:
`docs/specs/2026-10-19-plugin-marketplace.md`.

**Architecture:** `.claude-plugin/marketplace.json` is generated from each
`skills/*/skill.json` by `scripts/build-index.ts`, through a pure function in
`scripts/marketplace.ts`. One entry per Claude skill, `source: ./skills/<name>`,
version from skill.json, inline hooks only for `activation.default: "global"`.
Skill dirs stay where they are. Magpie's `bin/magpie` installs its own
dependencies on first run, because a plugin copy runs no postinstall.

## Ground Rules

- Runtime and test runner: Bun. `bun test` must pass before every commit.
- No new dependencies in the root `package.json` or any skill's `package.json`.
- Marketplace name is exactly `iceinvein-skills`; owner is `{ "name": "iceinvein" }`.
- Commit messages: Conventional Commits, lowercase subject, scope = skill or area, e.g. `feat(marketplace): generate plugin marketplace from skill manifests`. No `Co-Authored-By` trailer, no "Generated with" footer, no AI attribution of any kind. No em dashes anywhere in messages, docs or comments.
- Comments say why, never what. Match the style of the file being edited.
- A changed skill gets a patch bump with `bun run src/cli/index.ts bump <skill> patch`, which edits only that skill's `skill.json`.
- Never run `git add -A` or `git add .`; stage only the paths in the task's Touches.

### Task 1: marketplace builder

**Contract:** Needs: none | Offers: `buildMarketplace(skills: SkillManifest[]): MarketplaceFile` from `scripts/marketplace.ts`, where `SkillManifest = { name: string; description: string; version: string; author: string; tools: string[]; activation?: { default: "session" | "global"; claudeHookDirective?: string; claudeHookScript?: string; claudeStopScript?: string } }` and `MarketplaceFile = { name: "iceinvein-skills"; owner: { name: "iceinvein" }; plugins: PluginEntry[] }`, `PluginEntry = { name: string; source: string; description: string; version: string; author: { name: string }; hooks?: { SessionStart?: HookGroup[]; Stop?: HookGroup[] } }`, `HookGroup = { hooks: { type: "command"; command: string }[] }`. Plugins sorted by name.
**Touches:** scripts/marketplace.ts (new) | tests/marketplace.test.ts (test)
- [ ] Write tests in `tests/marketplace.test.ts` with hand-written expected JSON, one behaviour each: a Claude skill becomes an entry with `source: "./skills/<name>"`, description, version, author; a skill whose `tools` lacks `"claude"` is omitted; `activation.default: "session"` yields no `hooks` key; `activation.default: "global"` with directive + hook script + stop script yields exactly `SessionStart: [{hooks:[{type:"command", command:"echo 'Pick a channel.'; bash \"${CLAUDE_PLUGIN_ROOT}/scripts/session-start.sh\""}]}]` and `Stop: [{hooks:[{type:"command", command:"bash \"${CLAUDE_PLUGIN_ROOT}/scripts/stop-guard.sh\""}]}]`; global with directive only yields SessionStart `echo '<directive>'` and no Stop; a directive containing a single quote is shell-escaped as `'\''`; entries come out sorted by name. -> `bun test tests/marketplace.test.ts` fails (module missing)
- [ ] Implement `scripts/marketplace.ts` exporting `buildMarketplace` and the types. `${CLAUDE_PLUGIN_ROOT}` is a literal string in the output, not interpolated. -> `bun test tests/marketplace.test.ts` passes
- [ ] Commit `feat(marketplace): build plugin marketplace entries from skill manifests` -> SHA reported

### Task 2: magpie installs its own dependencies

**Contract:** Needs: none | Offers: `skills/magpie/bin/magpie` runs `bun install --production --silent` in the skill root (parent of `bin/`) when `package.json` exists there and `node_modules` does not, exits non-zero with a message on stderr naming the dir if that install fails, then execs `bun <bin>/magpie.ts "$@"` as before
**Touches:** skills/magpie/bin/magpie (edit) | skills/magpie/skill.json (edit) | tests/magpie-bin.test.ts (test)
**Review:** runs a package install on the user's machine
- [ ] Write `tests/magpie-bin.test.ts`: copy `skills/magpie` tracked files (`git ls-files skills/magpie`) into a tmpdir so no `node_modules` exists, run `bash <tmp>/bin/magpie --help`, assert exit 0 and that `<tmp>/node_modules/shiki` now exists. Second test: with `node_modules` already present, running `--help` leaves its mtime unchanged. -> first test fails on current wrapper
- [ ] Edit the wrapper: after resolving `DIR`, set the skill root to `$(dirname "$DIR")` and bootstrap as the Contract says. Keep the symlink resolution unchanged. -> `bun test tests/magpie-bin.test.ts` passes
- [ ] Bump magpie patch -> `skills/magpie/skill.json` version incremented
- [ ] Commit `fix(magpie): install runtime dependencies on first run when none are present` -> SHA reported

### Task 3: skill docs that assume a .claude/skills install

**Contract:** Needs: none | Offers: none
**Touches:** skills/scope-estimate/SKILL.md (edit) | skills/scope-estimate/skill.json (edit) | skills/migrate/SKILL.md (edit) | skills/migrate/skill.json (edit) | skills/sluice/references/deep-channel.md (edit) | skills/sluice/skill.json (edit)
**Effort:** low, three exact text edits with the replacement wording given and patch bumps by command
- [ ] `skills/scope-estimate/SKILL.md` around line 134: replace `bun .claude/skills/scope-estimate/scripts/schedule.ts` with `bun <skill-dir>/scripts/schedule.ts`, and replace the following "(Use `~/.claude/skills/...` if the skill was installed globally.)" sentence with "(`<skill-dir>` is this skill's base directory, stated when the skill loads.)", keeping the rest of that sentence's paragraph intact -> `grep -n ".claude/skills" skills/scope-estimate/SKILL.md` prints nothing
- [ ] `skills/migrate/SKILL.md` line 10: reword "put there by this skill's `install.sh`" so it reads that `migrate` is on PATH via `install.sh` under a bunx install, or via the plugin's `bin/` under a Claude Code plugin install -> `grep -n "plugin" skills/migrate/SKILL.md` shows the new line
- [ ] `skills/sluice/references/deep-channel.md` lines ~434 and ~536: where `sluice-implementer-low` is named as the subagent type, add that under a Claude Code plugin install the type is `sluice:sluice-implementer-low` -> `grep -n "sluice:sluice-implementer-low" skills/sluice/references/deep-channel.md` shows both
- [ ] Bump scope-estimate, migrate and sluice patch -> three skill.json versions incremented
- [ ] `bun test` -> passes (sluice-skill tests read these files)
- [ ] Commit `docs(skills): drop .claude/skills path assumptions for plugin installs` -> SHA reported

### Task 4: generate and check the marketplace

**Contract:** Needs: `buildMarketplace(skills: SkillManifest[]): MarketplaceFile` from `scripts/marketplace.ts` | Offers: `.claude-plugin/marketplace.json`, written by `bun run build:index` alongside `skills/index.json`; `release.sh` refuses a stale marketplace
**Touches:** scripts/build-index.ts (edit) | scripts/release.sh (edit) | .claude-plugin/marketplace.json (new) | skills/index.json (edit)
**Flips:** the repo goes from bunx-only to also being a Claude Code plugin marketplace
- [ ] In `scripts/build-index.ts`, read each full skill.json, pass them to `buildMarketplace`, write `.claude-plugin/marketplace.json` as `JSON.stringify(x, null, 2) + "\n"`, creating the dir. Update the header comment to say it writes both files. -> `bun run build:index` writes the file; `jq '.plugins|length' .claude-plugin/marketplace.json` equals the count of skills listing `claude` in tools
- [ ] In `scripts/release.sh`, extend the staleness check to `git diff --quiet -- skills/index.json .claude-plugin/marketplace.json` and name both files in the error -> `bash -n scripts/release.sh` passes
- [ ] `claude plugin validate . --strict` and `for d in skills/*/; do claude plugin validate "$d"; done` over every listed plugin -> all exit 0
- [ ] Integration: `export CLAUDE_CONFIG_DIR=$(mktemp -d)`; `claude plugin marketplace add "$PWD"`; `claude plugin install sluice@iceinvein-skills`, `magpie@iceinvein-skills`, `seam-finder@iceinvein-skills`; `claude plugin details sluice@iceinvein-skills` lists the skill, the `sluice-implementer-low` agent and SessionStart + Stop hooks; the installed magpie copy's `bin/magpie --help` exits 0 -> outputs pasted in the task report
- [ ] `bun test` -> passes
- [ ] Commit `feat(marketplace): publish skills as a Claude Code plugin marketplace` -> SHA reported

### Task 5: README install route

**Contract:** Needs: `.claude-plugin/marketplace.json` | Offers: none
**Touches:** README.md (edit) | docs/RELEASING.md (edit)
- [ ] README `## Install`: keep the bunx block and add a "Claude Code plugin" subsection with `/plugin marketplace add iceinvein/agent-skills` and `/plugin install <skill>@iceinvein-skills`; state: plugin skills invoke as `/<skill>:<skill>` (e.g. `/sluice:sluice`); updates via `/plugin` since third-party marketplaces do not auto-update by default; sluice's hooks always run when the plugin is enabled, terse is never auto-activated; do not install sluice through both routes (hooks run twice); sluice's statusline segment is bunx-only; magpie and migrate need Bun on PATH -> section present, no em dashes (`grep -c "—" README.md` unchanged from before the edit)
- [ ] `docs/RELEASING.md`: note that `build:index` also regenerates `.claude-plugin/marketplace.json` and the skill version bump is what reaches plugin users -> line present
- [ ] Commit `docs: document the Claude Code plugin install route` -> SHA reported
