# Run record: plugin marketplace

## Pre-flight

- Review: reviewer at every task T1-T5 plus the final review. Partner chose full coverage; the flip and the magpie package install are tier 3, and the prose tasks have no executable check.
- Effort: T3 at low (exact text edits and bump commands), all others at session effort. Ratified as planned.
- Workspace: one harness worktree, branch `worktree-plugin-marketplace` off master, implementers serial, each agent commits its own task. Only T1-T3 could overlap, so per-implementer worktrees were not worth buying.

## Decisions

- Marketplace named `iceinvein-skills`: `agent-skills` is reserved by Claude Code (confirmed or refuted by `claude plugin validate` in T4).
- Terse gets no plugin hooks (follows activation.default: session). Partner agreed.
- Sluice statusline documented as bunx-only. Partner agreed.
- Environment: a fresh worktree has no `skills/magpie/node_modules`, so 21 magpie tests fail until `bun install --cwd skills/magpie --frozen-lockfile` runs. T1's agent ran it; git-ignored, no tracked change. Baseline after that: 2319 pass, 0 fail.

## Task notes

- T1 (9c4715e): untested combinations left at obvious behaviour: global with hook script but no directive (SessionStart runs the script only), global with stop script only (Stop only), global with neither (no hooks key). No current skill has these shapes. Review clear; non-blocking note that sorting uses localeCompare where build-index uses default sort, same order for current names, left as is.
- T2 (34ffe3e): install output goes to stderr, not stdout as in install.sh, so commands that print data on stdout stay clean. Install-failure path untested: faking a broken bun would also break the wrapper's own bun.
- T2 review: BLOCKING, a failed first install leaves an empty node_modules, so later runs skip the install and crash on a missing package. Fix chosen: a success marker inside node_modules gates the install (also covers a killed install); costs bunx installs one no-op install on first run. Plus a failure-path test that works offline. Sent back to T2's agent after T3 finishes (shared tree). `install.sh` has the same flaw on the bunx route; out of scope, reported at handback.
- T3: `tests/eval-plugins.test.ts` pins case-local plugin copies to their sources, so a sluice edit needs `bun run eval:plugins`. Controller widened T3's Touches to the regenerated copies: mechanical sync under the repo's own convention, no behaviour change. T4 and later edits to skills may need the same.
- T2 fix (fd2f642): marker `node_modules/.magpie-deps-installed` gates the install. Round 2 review clear. Non-blocking, left as is: offline test sets only NPM_CONFIG_REGISTRY, so a machine with BUN_CONFIG_REGISTRY or a bunfig/npmrc registry would fail it deterministically; the success test needs network or a warm cache. Existing bunx installs pay one near no-op install on first run after update.
- T3 (2b6cef5): regenerated six sluice eval plugin copies (deep-channel.md + skill.json in three cases). One post-regeneration full run had 2 unidentified failures, the rerun on the same tree was 2321/0. Possibly flaky or interference from the concurrent T2 reviewer's runs; to identify in the T4 / final suite runs, not waved away.
- T3 follow-up (2aa89ac): review non-blockers fixed (SKILL.md rewrap, README `<skill-dir>` paths). sluice references/status.md bunx statusline paths left: statusline is bunx-only by agreement.
- T4: plan's per-skill `claude plugin validate skills/<name>` check was wrong: the validator needs a plugin.json in the dir, and the design deliberately has none (entry-only manifest; plugin.json plus inline entry components is a load error). Dropped by controller; evidence for the plugins is the isolated install: sluice 0.25.2 showed 1 skill, agent sluice-implementer-low, SessionStart + Stop hooks; installed magpie 0.14.2 bin/magpie --help bootstrapped deps and exited 0. Name `iceinvein-skills` accepted. Strict marketplace validate wanted a top-level description: added to the builder (Touches widened to scripts/marketplace.ts + its test), text is the README tagline. release.sh staleness check uses `git status --porcelain` so an untracked first-time file counts as stale. Suite 2322/0, intermittent failures did not recur.
- T4 review (c594d01): clear; release cannot ship a stale marketplace. Gap taken up: plugin users install from the default branch, and `bump` writes only skill.json, so master can carry a stale version (pinned version blocks the update) until release. Fix: a drift test in tests/marketplace.test.ts, same pattern as tests/eval-plugins.test.ts, so `bun test` catches it on every commit. Advice from validate: skill READMEs (magpie, migrate, scope-estimate) lack a marketplace install line; considered in T5. `writeIfChanged` name overstates (always writes; predates), left.
- T4 fix (caeef31): drift test, seen red on an unregenerated bump, green after revert.
- T5 (e145b82): README plugin route, RELEASING note, plugin install lines in magpie/migrate/scope-estimate READMEs (validator advice), those three bumped. Review: Bun note missed scope-estimate, fixed in 291785f. Unrelated pre-existing: README sluice row says "Seven rules", skill.json says nine; reported at handback, not fixed here.

## Hunt

Dispatched over master..HEAD against the spec after all five tasks were done. Report: `.bug-hunter/2026-10-19-plugin-marketplace/` (intent.md, scenarios.md, findings.json; report.md not written, the harness blocked it for the subagent). 2 bugs, 1 ambiguity, 14 covered.

- B1 (S8, I8 "under bunx the check is a no-op"): install.sh never writes the deps marker, so a bunx install reinstalls on magpie's first run. Fix: T6, install.sh shares the marker gate (also fixes install.sh's own failed-install poisoning noted in the T2 review).
- B2 (S12, I11 build-index exits 1 on an invalid skill.json): missing `author` writes `"author": {}`; missing `tools` exits via TypeError after index.json was rewritten. Fix: T7, validate marketplace fields before writing either file.
- A1: spec Verification asks for per-dir validate while the design has no plugin.json. Already settled at T4 (dropped); spec Verification updated to match.
- Not filed: plugin SessionStart command lacks the bunx `[ -f ]` guard (latent: the cache always has the script). Spec premise "a plugin copy has none [node_modules]" is wrong on this Claude Code version: plugin install ran the install itself, so the wrapper's bootstrap is a fallback there, still needed for versions or setups that do not. Magpie skill.json description bunx-only wording: fixed in T6.
- T6 (0d56f3c): install.sh gated on the marker, writes it on success; magpie 0.14.4, description covers both routes. Its test ran install.sh, which links into /usr/local/bin whenever writable with no override, so the test refused to run there. Partner chose a `MAGPIE_BIN_DIR` override in install.sh (new knob, documented in magpie README) over skipping or dropping the test.
- T6 follow-up (0c739a6): MAGPIE_BIN_DIR in install.sh plus README line. Incident: while watching the new test fail (old install.sh ignored the variable, HOME no longer redirected), the run relinked the user's real `~/.local/bin/magpie` to a tmpdir copy. The implementer restored it; controller verified it points at `~/.claude/skills/magpie/bin/magpie` and the real `.installed-cli-path` still reads `~/.local/bin/magpie`. Reported at handback. Later briefs forbid running install.sh without MAGPIE_BIN_DIR.
- T6 review: clear. Follow-ups sent: runInstall also sandboxes HOME; relative MAGPIE_BIN_DIR recorded absolute.
- T7 (9dea195): build-index validates author/tools before either write; marketplace built before the first write. Review clear. Non-blocking, left: rejects `author: ""` where the CLI accepts it (deliberate, it would emit an empty author); a non-string in `tools` says "missing" rather than "invalid"; no test pins index.json's applies/quick carry-over (untouched code).
- Not observed at runtime (no live session): `/sluice:sluice` invocation, `sluice:sluice-implementer-low` agent type, `bin/` on the Bash tool PATH.
