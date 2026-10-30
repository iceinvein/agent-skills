# Design: magpie impact map

(Sluice deep channel. Design signed off 2026-10-30; the task plan is
`docs/plans/2026-10-30-magpie-impact-map.md`.)

**Status (2026-10-30):** `magpie impact` (D1 to D3, D6's own logging and the `magpie shard`
re-run) and the specialist probe (D7) shipped. The flip that wired the map into the specialist
and critic prompts and stage 3 (D4, D5, D6's SKILL.md line) was built, measured in phase A
with no recall gain (1 of 21 targeted misses caught with the map, 1 of 21 without, full map
file opened in 0 of 21 runs), and reverted along with the 0.16.0 bump. Phase B was not run.
Nothing in a review calls `magpie impact` now. See `docs/plans/2026-10-30-magpie-impact-map-record.md`.

## Intent

The request, from the agent-skills-40 session on the user's behalf, quoted:

> design and build a deterministic "outside-diff impact map" for magpie (skills/magpie),
> working in its own git worktree. [...] So the idea is to give specialists facts, not
> instructions: in setup (or a new `magpie impact` subcommand), compute for each symbol the
> diff changes or adds its references outside the diff, plus sibling entry points and other
> writers where that can be detected cheaply, write it to `$RUN_DIR/impact.json`, and render
> it into the specialist prompt (next to the brief, see references/specialists.md part 5) and
> the critic prompt. Also look at docs/superpowers/specs/2026-08-03-magpie-code-intelligence-design.md:
> an earlier attempt via a code-intelligence MCP that no longer seems wired in. Find out why
> before repeating it.
>
> The design must say how it will be measured: evals/quality/replay-full.ts with the recall
> set (~/.magpie/corpus/misses), only pr-50-1789099641 and pr-70-1790391863 can be replayed,
> and run-to-run variance is large, so plan repeats and state the expected cost. Ask before
> adding any dependency (e.g. ctags, ast-grep, tree-sitter). [...] keep your edits there
> small and self-contained. [...] Don't merge or push.

Questions asked at the design stop (2026-10-30), with the user's answers:

- Dependency for finding references: **git grep only**, no new dependency (D2).
- How facts reach specialists: **hybrid, about 2 KB inline plus the full file by path** (D4).
- SKILL.md word cap: **raise to 3600** in `skill-lint.test.ts`, with a reason comment (D6).
- Measurement spend: **phase A (about $50), then phase B (about $210) only on a gain** (D7).

The design itself still awaits sign-off.

| Ask | Delivered by |
|---|---|
| References outside the diff for each changed or added symbol | D1, D2 kind 1 |
| Sibling entry points, where cheap | D2 (route literals only), limits in Out of scope |
| Other writers of the same data, where cheap | D2 kind 3 |
| (addition, not asked) Outside-diff definitions of names the diff uses | D2 kind 2: the only fact that reaches pr-50 miss-6 (weak), see D7 |
| (addition, not asked) Docs outside the diff that name changed symbols | D2 kind 4b: the request's own motivation lists "docs that contradict the code"; targets pr-50 miss-1 and miss-5 |
| Write `$RUN_DIR/impact.json` | D3 |
| Render into the specialist prompt next to the brief | D4 |
| Render into the critic prompt | D5 |
| Find out why code intelligence was dropped before repeating it | Context, D1 (how this differs) |
| Measurement plan with repeats and expected cost | D7 |
| Ask before any dependency | D2 uses `git grep` only; asked at this stop |
| Small, self-contained edits in setup-cmd.ts, specialists.md, SKILL.md (and critic.md, which the other session also edits) | D1 (no setup-cmd.ts edit), D4, D5, D6; each is an appended block or line, no rewording of existing text |
| Own worktree, no merge or push | `.claude/worktrees/magpie-impact-map`, branch `magpie-impact-map` |

## Context

- `docs/specs/2026-10-17-magpie-recall.md`: 66 real issues across eight runs, 29 never raised,
  17 of them needing code outside the diff. Ships the recall set and `judgeRecall` /
  `scoreRecall` (`evals/quality/recall.ts`), which this design reuses unchanged.
- `docs/plans/2026-10-17-magpie-recall-record.md`: prompt additions and a sixth `contracts`
  specialist measured 2/19 before and 2/19 after, then reverted. The probe found that more
  bullets did not make a specialist look at the files the misses live in. Three lessons this
  design takes as constraints:
  - budget caps make the replay agent ration shards, which confounded the last comparison, so
    caps must sit above observed cost and shard coverage must match across arms;
  - the caught set swapped between runs on pr-50, so one run per arm measures nothing;
  - a one-specialist, one-shard probe (about $1.1 a run) isolated the question better than a
    full replay (about $13 to $37 a run).
- `docs/superpowers/specs/2026-08-03-magpie-code-intelligence-design.md` (main tree only, the
  directory is untracked): live MCP tools (`get_call_hierarchy`, `trace_data_flow`,
  `find_affected_code`) given to specialists on demand. It explicitly put "a precomputed
  symbol-context pack injected into prompts" out of scope. This design reverses that one
  decision, for the reason below.
- **Why code intelligence went.** Commits `4ed3331`, `dbe295e`, `cafca24` wired it in (MCP,
  then the `code-intel` CLI); `48c9aaa` (2026-09-26) removed it with no stated reason beyond
  "specialists check reachability, callers and imports by reading the worktree". The evidence
  in `~/.magpie/*/log.jsonl`: six runs logged `codeIntelligence: true` with `interface: cli`,
  including `pr-50-1789099641`, the very run whose 14 misses are in the recall set. So
  specialists had on-demand caller and data-flow tools on that PR and still raised none of
  the 14. It also carried real operating cost: an external brew-installed index, per-repo
  consent, a completed base index or a GPU embedding pass, and session binding to clean up.
  What this design changes: facts are pushed, not pulled (computed once, before any agent
  starts, and placed where every specialist reads), it needs nothing but `git`, and the
  output is a file a person can read and a test can pin. Whether push beats pull is exactly
  what D7 measures; the history says pull alone did not work. If the user removed it for a
  reason not in the history, that reason should be checked against this design at sign-off.
- Code beside the path:
  - deterministic setup-time analysis already exists as `scripts/tests-check.ts`, run from
    `scripts/setup-cmd.ts:runTestsCheck`, writing a file the later stages read. The impact
    map follows that shape but as its own subcommand (D1).
  - `scripts/diff-utils.ts` (`parseUnifiedDiffToHunks`, `buildNewSideLineIndex`,
    `splitDiffByFile`), `scripts/shard.ts` (`ShardManifest`, files per shard),
    `scripts/path-filter.ts` (`loadPathFilterConfig`, `matchesAny`), `scripts/target.ts`
    (`reviewRoot`: the worktree, or the repo in local mode).
  - prompt parts are assembled by the orchestrator from `references/specialists.md` (part 5
    is the brief, rendered from `brief.json`); the critic prompt is filled by code
    (`scripts/critic.ts`, six placeholders, `critic-prompt` exits 1 if one is missing).
  - CLI dispatch is a table in `bin/magpie.ts` with lazy imports.
- Constraints: `bun test`, `bun run lint` (biome), and `bunx -p typescript tsc --noEmit` in
  `skills/magpie` (the record notes `bun run typecheck` exits 127); skill-lint caps SKILL.md
  below 3500 words (`scripts/__tests__/skill-lint.test.ts:232`, raised twice before) and
  SKILL.md is at 3489 today, before the other session's edits land; `~/.claude/CLAUDE.md` (tests first, hand-written expected values, no hacks,
  no em dashes, no AI attribution). Another session is editing `setup-cmd.ts`, `gh.ts`,
  `incremental.ts`, `scout.md`, `specialists.md`, `critic.md` and `SKILL.md` on master in
  parallel.
- Available tools: `git` (required already), `rg` and BSD `ctags` on this machine but not
  guaranteed on users'; no `ast-grep`, `tree-sitter`, or universal-ctags.

## Decisions

### D1. A `magpie impact <run-dir>` subcommand, not a setup step

New `scripts/impact.ts` (pure: diff text and grep output in, facts out) and
`scripts/impact-cmd.ts` (runs `git grep`, reads the manifest, writes files), wired into
`bin/magpie.ts`. It reads `diff.patch`, `shards/manifest.json`, `.magpie.json` via
`loadPathFilterConfig`, and greps in `reviewRoot(runDir)`. It touches nothing in
`setup-cmd.ts`, which keeps the parallel session's conflicts out of this branch, and it can be
re-run after a re-shard. It exits 0 with files written, or non-zero with a one-line stderr;
a failure never fails the review (D6).

### D2. What it computes, with `git grep` only

No new dependency. Every search is `git grep -n -w -F -e <name>` (or `-F` without `-w` for
string literals) over tracked files in the review root, one batched call per kind with
multiple `-e`. Results drop any line the diff added (the `added` lines from
`parseUnifiedDiffToHunks`; `buildNewSideLineIndex` also counts context lines, so it is not
the right filter) and any
path the path filter excludes, so "outside the diff" means "not on a changed line", which
keeps unchanged siblings in a changed file.

Four fact kinds:

1. **Changed symbols and their references.** Names defined on an added or removed line, plus
   the enclosing function git prints in each hunk header (`@@ ... @@ fn foo(`), which covers a
   changed body whose signature line did not change. Definition patterns, by extension:
   TS/JS (`function`, `class`, `interface`, `type`, `enum`, `const|let X =`, `export`),
   Rust (`fn`, `struct`, `enum`, `trait`, `type`, `const`, `static`), Python (`def`, `class`),
   Go (`func`, `type`), shell (`name()`). Output: each symbol, where it is defined, whether it
   was added, changed or removed, and its references outside the diff.
2. **Names the diff uses but does not define.** Identifiers on added lines (including
   backticked names in Markdown) whose only definition matching the patterns above is outside
   the diff. Output: the definition's `file:line`. This is the "callee" side: what the new
   code relies on.
3. **Other writers of the same data.** Store names taken from added lines: identifiers passed
   to `insert(`, `update(`, `delete(`, `from(`, `into(` and SQL `INSERT INTO`, `UPDATE`,
   `DELETE FROM`, `FROM`, `JOIN`; and string literals ending `.db`, `.sqlite`, `.sqlite3`.
   Output: outside-diff lines that write that store (the same write verbs, or the literal
   for file stores).
4. **Sibling entry points and docs.** Route literals on added lines (`"/api/..."`-shaped
   strings) and the other route literals outside the diff sharing their first two segments;
   Markdown files outside the diff that mention a changed symbol or a changed file's basename.

Noise limits, all constants in `impact.ts`: names shorter than 4 characters and a short
stoplist (`self`, `this`, `data`, `value`, `result`, `error`, `props`, `index`, `name`,
`test`, `main`, `new`, ...) are skipped; at most 12 references per name, with the true hit
count kept so a reader sees "12 of 230"; a name with more than 200 hits is listed with its
count and no references, since a name that common names nothing. No type resolution: two
functions with one name share references, and the output says so by listing both
definitions.

### D3. Outputs: `impact.json` plus rendered Markdown per shard

`$RUN_DIR/impact.json`:

```
{ version: 1,
  symbols: [{ name, kind: "added"|"changed"|"removed", definedAt: [{file, line}],
              shard: n|null, hits, references: [{file, line, text}] }],
  uses:    [{ name, usedIn: {file, line}, shard, definedAt: [{file, line, text}] }],
  stores:  [{ name, kind: "table"|"file", usedIn: [{file, line}], shard, writers: [{file, line, text}] }],
  routes:  [{ path, usedIn: {file, line}, shard, siblings: [{file, line, text}] }],
  docs:    [{ file, line, text, mentions: [name] }] }
```

`text` is the trimmed source line, cut at 160 characters. Code renders `impact.md` (whole
run) and, when sharded, `impact.shard-<n>.md` holding the entries whose diff-side anchor is
in that shard. Each Markdown file is capped at 8 KB: entries are ordered stores, symbols with
a changed or removed signature, uses, routes, docs, and whatever does not fit is counted in a
last line ("N more entries in impact.json") rather than silently cut. Under D4's
recommended option, each also gets a `.brief.md` sibling of the same entries in the same order
capped at 2 KB, ending with the same count line. No file is written for
a shard with no entries, as with `excluded-files.json`.

### D4. Specialists get the top facts inline and the rest by path

The request says "render it into the specialist prompt" and "give specialists facts", so a
path alone would be the pull model that failed with code intelligence. But the orchestrator
assembles specialist prompts by hand, so inlining a full 8 KB file means copying it into up
to 35 prompts as output tokens (about 70k tokens and minutes of wall clock on a 7-shard PR).

Chosen by the user: a hybrid. `magpie impact` also writes `impact.shard-<n>.brief.md`, capped at
2 KB (the highest-ranked entries from D3's order, about 15 lines), which the orchestrator
pastes into part 6 as it pastes the brief; the full file is named by path for the rest.
Not chosen: inlining the full 8 KB file, or a path alone.

When the shard's impact file exists the orchestrator adds one line under `Diff:` in the run
header, `Outside the diff: <RUN_DIR>/impact[.shard-<n>].md`, and a new part 6 after the
brief, verbatim, with the brief file's content in place of `<top entries>`:

```
## Outside the diff

<top entries>

<the path above> has the full list. For the code in your scope it shows what sits outside the diff:
references to the symbols this change defines or alters, the definitions it calls,
other code that writes the same tables or files, sibling routes, and docs that name
what changed. It was computed by text search, so a name shared by unrelated code shows
up too. Read it before the diff. A finding that rests on one of these locations
anchors on the diff line that triggers it and cites the outside location in
Observation.
```

That is the only text added to `specialists.md`: a header line and one fenced block, no
changes to the focus blocks. D7's probe records whether the full file is opened, and whether
findings cite locations that were only in the inline part or only in the file.

### D5. The critic gets the facts for its batch inline

`critic-prompt` is code, so inlining is free there. A seventh placeholder `<<IMPACT>>` in
the `magpie-critic` block is filled by `critic.ts` with the `impact.json` entries whose
anchor file or reference files include a candidate's `file`, rendered as in D3 under the same
8 KB cap, or `(none)` when there is no `impact.json` or nothing matches. One sentence goes
into "How to check each candidate" step 2: these are leads for where a guard, caller or
other writer may be, to be read and checked, not proof. The placeholder check in
`critic.ts` adds it to the required list, so a template without it still exits 1.

### D6. SKILL.md wiring, kept to one sentence

SKILL.md is 11 words under its cap, so the wiring moves into code wherever it can:

- `magpie impact` appends its own log entry, `{stage: impact, status: done, symbols, stores,
  routes, docs}` or `{stage: impact, status: skipped, error}` with exit 0, as setup logs its
  own stages. So no logging prose is needed, and a failure never stops the run.
- `magpie shard` re-runs the impact computation after re-splitting when `impact.json` exists,
  so the re-shard sentence does not change.
- Stage 3 gains one sentence of about 14 words: run `magpie impact "$RUN_DIR"` before
  dispatching the scout and checks, and re-run it on resume when `impact.json` is missing.

Those 14 words still break the cap (3489 + 14 > 3500), and the other session's SKILL.md
edits will add more. Chosen by the user: raise the cap to 3600 in `skill-lint.test.ts`, with a
comment line giving the reason, as the two earlier raises did. That edits a test, so it needs
the user's agreement. The alternative is to trim 14 or more words of existing stage text,
which would collide with the other session's edits. The `impact` log entry is diagnostic like
`tests-check`: it does not enter the progress stage list, so `render-progress.ts` and
`status-cmd.ts` do not change (a plan task verifies that an unknown stage entry is ignored
by both, with a test if none exists).

### D7. Measurement

Targets in the replayable recall set: 12 of the 19 misses are `outsideDiff`. Mapped against
D2's fact kinds:

| Miss | Fact kind that reaches it | Status |
|---|---|---|
| pr-70 miss-1 (uuid namespace) | stores: writers of `videoVerification` / `reportVerification` | traced below |
| pr-50 miss-6 (harness uses real history.db) | uses: `clear_seed_snapshots` defined at `seed.rs:679` | traced below, weak |
| pr-70 miss-2 (caller-supplied snapshot ids) | symbols: callers of the changed export job | plausible, untraced |
| pr-70 miss-3 (null read as still sealing) | symbols: callers of `verifyBitcoinAnchor` | plausible, untraced |
| pr-50 miss-1, miss-5 (design doc contradicts) | docs mentioning changed symbols | plausible, untraced |
| pr-50 miss-9 (deferred tab walk) | symbols: callers in `worker.rs` | plausible, untraced |
| pr-70 miss-4, pr-50 miss-3, 8, 12, 14 | none (persisted flag semantics, process convention, harness semantics, parking_lot rule, CI timing) | not targeted |

Two phases, the second gated on the first (the user's choice):

- **Phase A, specialist probe (about $50).** New `evals/quality/probe-specialist.ts`,
  committed this time (the record's probe lived in a scratchpad and is gone). For a corpus run
  it checks out `headRefOid` in a temporary worktree of `--repo`, rebuilds the run dir from
  the corpus copy of `diff.patch` and `shards/manifest.json`, runs `magpie impact`, builds the
  specialist prompt exactly as `specialists.md` says (with or without the D4 header line and
  part 6), runs `claude -p` for one `(focus, shard)`, and judges the findings file with
  `judgeRecall` against the misses in that shard. Arms: base and impact. Pairs: the owning
  domain and shard of each of the 7 targeted misses (about 7 pairs), 3 repeats per arm, so
  about 42 runs at about $1.1 to $1.3 each. Also logged per run: whether the agent read the
  impact file (from the `claude -p` JSON transcript's tool calls) and how many findings cite
  an outside location.
- **Phase B, full replay (about $210, ceiling $260).** This is the measurement the request
  names. Chosen by the user: run it only if phase A shows a gain, because a flat phase A at $50
  already answers the question, and phase B costs four times as much with two repeats that
  variance can swamp. The alternative is to run phase B regardless, so `replay-full.ts`
  always produces the reported number.
  `replay-full.ts` on pr-50 and pr-70, base and impact arms, 2 repeats each: 8 runs. Caps
  `--max-cost-usd 45` for pr-50 and `20` for pr-70, above the highest observed ($37.26 and
  $16.63), so neither arm rations shards; a run whose shard coverage differs from its pair is
  discarded and re-run, not compared. The base arm is the branch with D4 to D6 reverted, so
  both arms share every other prompt as it stands today (the 2026-10-17 baselines predate
  later prompt changes and are not reused). Reported per arm: missed-recall c/n,
  outside-diff recall, kept count, label precision, cost, and `impact.md` size.
- **Reading.** Nothing decides automatically. My proposed bar for keeping the flip: in phase
  A, the impact arm catches at least 3 more (miss, repeat) hits than base pooled over the 7
  targets, with the read rate above half; in phase B, the impact arm's outside-diff recall is
  above base in both repeats and kept count does not grow by more than a third. Phase A
  alone would cost about $50; both phases about $260, ceiling about $320 with re-runs.

### D8. Order and flip

1. `impact.ts` pure extraction, tests first on hand-written diffs.
2. `impact-cmd.ts`, the CLI entry and its own log entry, and the `magpie shard` re-run, with
   one integration test over a small real git repo built in a temp dir (real `git grep`,
   hand-written expected `impact.json`).
3. Markdown rendering and the per-shard split, tests first.
4. `critic.ts` `<<IMPACT>>` filling and filtering, tests first, inert until the template has
   the placeholder.
5. `probe-specialist.ts` (pure parts unit-tested: prompt assembly with and without the impact
   parts, transcript read detection).
6. Phase A, base arm only, which needs no flip because the probe builds prompts itself.
7. **Flip:** `specialists.md` header line and part 6, `critic.md` placeholder and sentence,
   SKILL.md stage 3, re-shard and resume lines, README, version bump. Then phase A's impact arm.
8. Phase B, if the user reads phase A as a gain.

## Out of scope

- AST or type-aware resolution (ctags, ast-grep, tree-sitter, LSP): not without the user's
  go-ahead, and D7 should first show text search moves recall at all.
- Route siblings behind framework prefixes (Elysia `group`, Express `Router` mounts): the
  route literal in pr-70 is `"/"` under a group, so D2's route kind would not reach miss-1;
  the stores kind does. Prefix resolution per framework is not cheap.
- The misses no fact reaches (table in D7): conventions in unread skill files, scenario
  harness semantics, CI timing.
- Precision tuning of the critic beyond the one sentence in D5.
- Interaction with the incremental re-review and PR-comment ingestion the other session is
  building: the map is computed on the whole diff; scoping it to an incremental range is
  theirs to wire if wanted.
- Any edit to `setup-cmd.ts`, `scout.md`, `gh.ts`, `incremental.ts`.

## Trace

The request's own examples: "sibling routes sharing an id namespace, other writers of the
same data (seeds, importers, migrations)". Walked at the reviewed SHAs in the local
`workings` clone, which is what `reviewRoot` would be in a replay.

**pr-70 miss-1, at `3f9f3bd`.** The diff adds `packages/backend/src/api/crypto/lock-uuid-namespace.ts`,
whose added lines include `.from(videoVerification)` and `.from(reportVerification)`, and
whose doc comment claims "registration itself refuses a uuid registered by someone else".

- D2 kind 3 takes `videoVerification` and `reportVerification` as table stores from the
  `from(` calls.
- `git grep -n -E '(insert|update|delete)\((videoVerification|reportVerification)\)'` at that
  SHA returns six writer lines, none on a changed line: the two registration routes
  (`report-verification.ts:158` update, `:178` insert; `video-verification.ts:82` update,
  `:121` insert) and the admin deletes (`api/admin/verification.ts:137`, `:183`).
- Reading `video-verification.ts` around line 121 shows the pre-insert check looks only at
  `videoVerification`. That is the miss: each registration route checks its own table, so the
  comment's claim is false.
- So `impact.shard-<n>.md` for the shard holding `lock-uuid-namespace.ts` would list, under
  stores, both registration routes by `file:line`. The specialist still has to connect the
  comment's claim to them; the map only removes the search. The route-sibling kind does not
  help here: the Elysia routes are `.post("/")` under a group prefix (Out of scope).
- Kind 1 also lists the two callers of the new functions, `crypto/reports.ts:11` and
  `crypto/videos.ts:11`, which are in the diff on changed lines and so are dropped as
  outside-diff references: correct, since they are already in scope.

**pr-50 miss-6, at `4bce470`.** The 76-file diff never names `history.db`. It mentions
`clear_seed_snapshots` once, in a backticked Markdown line (`diff.patch:10411`).

- D2 kind 2 takes `clear_seed_snapshots` from the Markdown backticks; its definition matches
  the Rust `fn` pattern at `packages/desktop/src-tauri/src/commands/seed.rs:679`, outside the
  diff, with callers at `seed.rs:878` and `seed.rs:1812`.
- The map would list that definition. The miss (the harness seeds into the developer's real
  database) needs the reader to open `seed.rs` and see it opens `get_data_dir()/history.db`
  (also named at `account.rs:547`). That is two hops, so I mark this target weak.
- The stores kind does not fire: no added line names `history.db`.

What each reused function requires, read from the code: `buildNewSideLineIndex(diff)`
(`diff-utils.ts:86`) returns new-side lines of type `added` and `context`, so D2 builds its
own added-line set from `parseUnifiedDiffToHunks`, which also yields the removed lines kind 1
needs; `reviewRoot(runDir)` (`target.ts:54`) reads `target.json`, falls back to
`<runDir>/worktree` when only `log.jsonl` exists, and throws "not a magpie run" otherwise, so
`magpie impact` runs after setup and surfaces that error as its non-zero exit; the manifest's
`shards[].files` are plain path strings.
