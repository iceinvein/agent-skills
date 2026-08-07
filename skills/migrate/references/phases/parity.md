# Phase 4: Parity

## Purpose

Assign an oracle to every requirement whose confidence is not `queued`, and
maintain the sanctioned-difference catalog for whatever legitimately cannot
match. Exit condition: no unsigned delta in `deltas.jsonl`, every non-queued
requirement carries a parity value, and `migrate phase parity --status
done` has run.

## Inputs

- `config.toml`: `target.parity_test_path`, the template every parity `ref`
  must be built from by hand. Its shipped default is
  `tests/parity/{capability}/{fr_slug}.test.ts`; probe.md is where an
  operator would have hand-edited it to something else, so read it, never
  assume the default.
- `.migrate/parity-basis.md`: hand-written prose from probe, carrying
  whether the source is `runnable` or `source-only` and the detection
  evidence behind that call. This phase does not redetect it; it reads what
  probe already decided.
- The store: `requirements.jsonl` (every non-queued row needs a plan),
  `deltas.jsonl` (existing sanctioned differences, checked before writing a
  new rubric or a new delta rather than after).

## Procedure

**The three parity kinds, stated once, before anything is assigned.**
`parity.kind` is `golden-master`, `differential`, or `rubric`.

- **`golden-master`.** Capture the legacy system's actual output for a
  fixed input once, and assert the target reproduces it exactly. Fits a
  deterministic, replayable behavior: the same request into the same state
  gets the same response every time, so one captured snapshot is a
  reusable oracle.
- **`differential`.** Run both systems side by side on the same input and
  diff the two live results, rather than trusting one frozen capture. Fits
  a behavior whose *exact* output legitimately varies (a token, a
  timestamp, a generated id) while the comparison that actually matters
  (did both systems accept, reject, and decide the same way) still
  automates cleanly.
- **`rubric`, with a `level` of `high`, `moderate`, `low`, or `unknown`.**
  For when no automatable oracle exists at all: a `source-only` basis with
  nothing to run, or a behavior that crosses a boundary neither capture nor
  live diffing can reach (an external mail send, a third-party callback).
  **Only `level: high` needs no queue id; `moderate`, `low`, and `unknown`
  each require one**, because a rubric below `high` is itself a claim that
  something is not fully known, and that claim needs an owner's eyes, not a
  guess standing in for one.

A worked example, run against a real store, assigning all three kinds
across the requirements extract.md mined:

```json
{ "id": "UM-001", "parity": { "kind": "differential", "ref": "tests/parity/user-management/login.test.ts" } }
{ "id": "UM-002", "parity": { "kind": "golden-master", "ref": "tests/parity/user-management/list-users.test.ts" } }
{ "id": "UM-003", "parity": { "kind": "rubric", "level": "moderate", "queue": "q-parity-um-003-reset-flow" } }
```

(each shown here trimmed to its `id` and `parity` field; the real batch
carries every other required field for each row unchanged). UM-001 gets
`differential`: both systems get the same credentials, and while the issued
token differs, whether the attempt succeeds and what it rejects must match.
UM-002 gets `golden-master`: a `GET` with no side effects and no
input-dependent branching is exactly the deterministic case golden-master
fits. UM-003 gets `rubric:moderate`: its confidence was already `inferred`
in extract.md, since nothing in the source shows what happens when a reset
token is actually submitted, so no automated oracle has anything to run
against, and the `moderate` level needs the queue id it names.

`migrate import reqs batch.json` accepts this and prints `import reqs: 0
added, 3 updated, batch b-reqs-parity-001`: this is the write-back
`SKILL.md` calls out as load-bearing, in the same shape as extract's
disposition write-back. `parity` has exactly one writer, this import; the
phase-status flip at the end of this phase does not touch it.

**Show the substitution, because nothing else will.** `{capability}` is the
capability's own `slug` from `capabilities.jsonl`, already known.
`{fr_slug}` has no deriving code anywhere in this CLI: it is a short,
kebab-case name you choose by hand for what the requirement actually is
(`login`, `list-users`), not the arbitrary FR id (`UM-001` tells a reader of
the test tree nothing). This is hand work the same way writing
`capabilities.jsonl` itself is hand work in seam.md: nothing imports a
parity plan's `ref` against the template, checks that it resolves to a real
file, or even checks that it looks like the template at all. Verified
directly, run against a real store: a `golden-master` row with
`"ref": "this/path/does/not/exist/anywhere.test.ts"`, matching neither the
template nor any real file, imports cleanly and passes `migrate check`
without a single violation. The convention is entirely this manual's
discipline; get the substitution right by hand, because no gate is behind
you if you do not.

**Deltas exist to record sanctioned differences, never to silence a real
failure.** State this before writing one, not after: a delta is a *reason*
a difference is acceptable, backed by a rationale a reviewer can check, not
a lever for making an inconvenient test pass. If a parity test fails and
the honest cause is "the requirement was wrong" or "the target has a bug,"
the fix is to correct the requirement or the target, never to paper over
the failure with a delta whose rationale was written after the fact to fit.
A delta's `parity_exclusion` field says precisely what a parity test may
not assert on, not that the whole area is exempt from comparison.

A worked example, run against a real store. The target sends password-reset
emails through an async queue; the legacy system sent them synchronously in
the request, so response timing between the two systems now legitimately
differs for reasons that have nothing to do with correctness.

```json
{
  "id": "delta-async-email-delivery",
  "scope": "Password reset email delivery timing (UM-003)",
  "rationale": "The target sends reset emails through an async queue instead of synchronously in the request, so response timing legitimately differs from the legacy system.",
  "parity_exclusion": "The UM-003 parity check must not assert on how soon the email was actually sent, only that a send was enqueued.",
  "validation": "A separate async-delivery test in the greenfield-only suite confirms the queued job eventually sends the email; the parity suite does not re-prove it.",
  "owner_signed": null
}
```

`migrate import deltas batch.json` accepts this (`owner_signed: null` is a
valid value while a delta is proposed but not yet ratified) and prints
`import deltas: 1 added, 0 updated, batch b-deltas-001`. Unsigned, it fails
its own gate, run for real:

```
deltas:
    delta-async-email-delivery is not owner-signed
```

Re-import the same id with `"owner_signed": "2026-08-07"` once an owner has
actually looked at it, and the gate clears; `deltas` never appears again in
the same store's `check` output.

### The split-suite discipline

Three suites, kept apart on purpose:

- **parity.** Tests whose whole job is proving the target matches the
  legacy system, one per requirement's `parity.ref`. This is the only suite
  a delta's `parity_exclusion` ever narrows.
- **greenfield-only.** Tests for target-only behavior with no legacy
  analog: the async email queue itself, from the delta above, is exactly
  this. Nothing here compares against the legacy system, because there is
  nothing on the legacy side to compare against.
- **legacy-only.** Behavior deliberately not carried forward. An
  `out-of-scope` element (`route-get-legacy-admin-tool`, from extract.md)
  gets no parity test at all; there is no requirement to assign one to, and
  writing one would imply a comparison this run explicitly decided not to
  make.

### Parity coverage

**Every requirement whose confidence is not `queued` must carry a parity
value; a `queued` requirement is exempt.** The exemption exists because a
queued requirement's entire content, not just its oracle, is still
provisional: assigning it a parity plan before an owner has even confirmed
the requirement is real would be planning a test for something that might
not exist. Verified directly: a requirement with `confidence: {kind:
queued, ...}` and `parity: null` produces no `parity` gate violation,
run against a real store; the same row with `confidence: confirmed` and
`parity: null` produces exactly one, naming the requirement's id.

**The honest limit: a parity plan on record is a commitment, not a proof.**
`check`'s parity gate is satisfied once `parity` is a well-formed value; it
never runs `target.commands.test`, never opens the file the `ref` names,
and never confirms the test that file describes actually exists or passes.
Writing `{"kind": "golden-master", "ref": "..."}` and later writing the test
file at that path are two separate acts, and only the manual's own
discipline connects them.

## What closes it

`migrate check --phase parity` mid-run reads the same way extract's did:
noisy on the surfaces this scratch run never enumerated, and quiet on
everything parity itself owns once every non-queued requirement has a plan
and every delta is signed. Run for real, right after the delta above was
signed:

```
4/5 mapped, 1 out-of-scope, 0 unaccounted

Violations (7):
  census:
    declared surface jobs has no lens census record; the lens did not run or did not close
    declared surface reports has no lens census record; the lens did not run or did not close
    declared surface screens has no lens census record; the lens did not run or did not close
    declared surface integrations has no lens census record; the lens did not run or did not close
    declared surface workflows has no lens census record; the lens did not run or did not close
    declared surface settings has no lens census record; the lens did not run or did not close
  run-state:
    phase parity is running; every phase through parity must be done
```

Neither `deltas` nor `parity` appears: both are already clean at this
point. Flip the phase:

```
migrate phase parity --status done
```

## Degradation

- **`source.basis` is `source-only`.** No live legacy system to run a
  `differential` against, and often nothing to capture a fresh
  `golden-master` from either, unless an existing fixture or recorded
  output in the source already plays that role. When neither is possible,
  `rubric` is what remains; expect more `moderate`, `low`, and `unknown`
  levels, and more queue items, on a `source-only` run than on a `runnable`
  one.
- **The target's test command is still `init`'s placeholder.** A parity
  plan can still be recorded (the gate only checks the value's shape); the
  test itself has nowhere real to run yet. This is exactly the "commitment,
  not proof" limit above, sharpest right after probe when `target.commands`
  has not been wired up.
- **Genuinely unclear which rubric level applies.** Use `unknown` rather
  than guessing a specific level to avoid a queue id; `unknown` still needs
  one, so nothing is gained by picking a falsely specific level instead.

## Commands

```
migrate import deltas <batch.json>
migrate import reqs <batch.json>
migrate queue add <item.md>
migrate phase parity --status done
```
