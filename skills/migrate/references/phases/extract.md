# Phase 3: Extract

## Purpose

Mine functional requirements out of every capability's elements, keeping a
citation trail back to the evidence, and give every element a terminal
disposition. Exit condition: every capability has been mined, every element
carries `disposition.kind` of `mapped` or `out-of-scope` (never
`unaccounted`), every declared closer in `[closers].set` has one `closer`
census record, and `migrate phase extract --status done` has run.

## Inputs

- `config.toml`: `[closers].set` (the closers you owe a census record,
  independent of how many you happen to find), `source.stack` (whether a
  recipe supplies attribute directions the way it supplies lens directions
  in enumerate; contract-only applies here exactly as it does there).
- The store: `capabilities.jsonl` (the fanout unit; every element inside one
  capability's `elements` array is this pass's scope), `elements.jsonl`
  (every row still `unaccounted` after enumerate is what you are mining),
  `requirements.jsonl` (what already exists, for resuming without
  re-mining), `phases.json` (committed batches, for resuming).
- The source checkout (read-only): the citation gate resolves every `src`
  citation against it.

## Procedure

**Extract's contract, stated once.** For each capability, read every
element it owns, decide what functional requirement that element's evidence
actually supports, write one requirement per distinct behavior with at
least one citation, and write back a terminal disposition onto every
element the requirement accounts for. Nothing here is optional: an element
extract does not dispose of stays `unaccounted` forever, since disposition
has exactly one writer (below), and a requirement with no citation cannot
be imported at all.

1. **Fan out one agent per capability.** A capability is the unit; an agent
   mining `user-management` never needs to know what `invoicing` looks
   like. See `references/run-ops.md` for dispatch and checkpoint mechanics;
   this manual does not restate them.

2. **Confidence tiers, and the evidence trust order that sets them.** Every
   requirement's `confidence.kind` is `confirmed`, `inferred`, or `queued`.
   When two lenses' evidence disagree about what the source actually does,
   trust them in this order, strongest first: **`runtime` > `code` > `nav`
   > `docs`**. Runtime is what the system actually did when observed;
   `code` is the logic that decides what it does, but a path can be dead or
   never actually reached; `nav` shows what is exposed, not what it does
   once reached; `docs` is aspirational and goes stale fastest of the four.
   Assign the tier from what the trusted evidence actually shows, not from
   how confident you feel: **confirmed** when the highest-trust evidence
   available is unambiguous and nothing contradicts it; **inferred** when
   the evidence shows part of the behavior but a piece is genuinely
   unobservable from here (a call to something outside the citable source);
   **queued** when the evidence conflicts or is too thin to call either way
   and an owner has to.

3. **Origin tagging is a second, independent judgment, not a restatement of
   confidence.** `origin` is `intended` or `accidental-candidate`.
   Confidence asks "how sure am I this is what happens"; origin asks
   "does this read as deliberate, or as something nobody meant to build
   this way." A requirement can be fully confirmed and still
   accidental-candidate: the evidence can be completely unambiguous about
   *what* happens while leaving open *whether it should*.

   A worked example, run against a real store. `Controllers/AuthController.cs`
   has a `Login` method that validates credentials, a `GetUsers` method with
   no `[Authorize]` attribute and no auth check of any kind, and a
   `ResetPassword` method whose comment says only "no test coverage in the
   legacy system; behavior beyond 'a link is emailed' is not observable from
   this method alone":

   ```json
   [
     {
       "id": "UM-001",
       "cap": "user-management",
       "requirement": "User must provide a valid email and password to log in",
       "actors": "User",
       "objects": "Credentials",
       "rules": "Email must contain @; password minimum 8 characters",
       "origin": "intended",
       "confidence": { "kind": "confirmed" },
       "citations": [
         { "kind": "ledger", "id": "route-post-api-login" },
         { "kind": "src", "path": "Controllers/AuthController.cs", "lines": [9, 25] }
       ],
       "parity": null
     },
     {
       "id": "UM-002",
       "cap": "user-management",
       "requirement": "Any caller can list every user, with no authentication check",
       "actors": "Any caller",
       "objects": "User list",
       "rules": "-",
       "origin": "accidental-candidate",
       "confidence": { "kind": "confirmed" },
       "citations": [
         { "kind": "ledger", "id": "route-get-api-users" },
         { "kind": "src", "path": "Controllers/AuthController.cs", "lines": [27, 32] }
       ],
       "parity": null
     },
     {
       "id": "UM-003",
       "cap": "user-management",
       "requirement": "User can request a password reset link by email without the response revealing whether the account exists",
       "actors": "User",
       "objects": "Reset token",
       "rules": "Response is identical whether or not the account exists",
       "origin": "intended",
       "confidence": { "kind": "inferred" },
       "citations": [
         { "kind": "ledger", "id": "route-post-api-password-reset" },
         { "kind": "src", "path": "Controllers/AuthController.cs", "lines": [34, 45] }
       ],
       "parity": null
     }
   ]
   ```

   (this is the batch file's `rows` array; the envelope carrying `batch` and
   `phase` around it is elided here since import-cmd.ts's own shape is
   already covered above.)

   `migrate import reqs batch.json` accepts all three in one call and prints
   `import reqs: 3 added, 0 updated, batch b-reqs-um-001`. UM-002's
   confidence is `confirmed` because the missing auth check is not in doubt;
   its origin is `accidental-candidate` because nothing in the source
   suggests leaving every user's data open to any caller was ever a decision
   anyone made. UM-003 is where the evidence trust order actually bites:
   `code` confirms a link is sent and that a missing account does not change
   the response, but nothing citable in this source shows what happens once
   a token is submitted, so that piece is `inferred`, not `confirmed`, no
   matter how confident the wording sounds. `parity` is `null` on all three
   on purpose: assigning an oracle is phase 4's job, not this one's, and the
   parity gate exempts nothing at `confirmed` or `inferred`, only at
   `queued` (parity.md covers why).

### Mandatory citations, and the citation gate

**At least one citation is required on every requirement; `migrate import
reqs` refuses one with none.** This was always the rule; what changed is
that a fabricated `src` citation now fails a gate instead of merely
breaking one. `citations` runs by default (`--no-citations` opts out) and
resolves every `src` citation against the read-only source checkout,
line ranges included.

A worked failure, run on a disposable copy of the store so this defective
row never enters the running example: a requirement citing a controller
that was never part of the checkout.

```json
{ "kind": "src", "path": "Controllers/SessionController.cs", "lines": [10, 20] }
```

`migrate import reqs` accepts the row (the importer only checks shape, not
existence), but `migrate check` reports it under its own gate, by name:

```
citations:
    UM-004 cites Controllers/SessionController.cs, which does not exist in the source tree
```

A citation with an inverted range (`start > end`) or a range past the
file's actual line count fails the same gate the same way, each with its
own message naming the requirement and the exact problem.

### Writing the disposition back

**Past enumerate, the elements batch you import here is the only writer of
a *resolved* `disposition`.** Nothing about writing a requirement changes an
element's disposition by itself; every element the requirement accounts
for needs its own row in an elements batch, disposition set to `mapped`
with the requirement's id, or to `out-of-scope` with a queue id if it is
being carried forward unmapped on purpose. This is the write-back
`SKILL.md` calls out as load-bearing: a review found the walkthrough could
not clear its own coverage gate without this second import, because
nothing else moves an element toward a terminal disposition once enumerate
ends. (`migrate reset --phase extract` also writes this field, but only
back to `unaccounted`, undoing the phase rather than progressing it.)

A worked example, run against the same store, four elements mapped and one
carried out of scope:

```json
[
  { "id": "route-post-api-login", "surface": "routes", "element": "POST /api/login",
    "found_by": ["code", "nav"], "disposition": { "kind": "mapped", "fr": "UM-001" },
    "refs": [{ "kind": "src", "path": "Controllers/AuthController.cs", "lines": [9, 25] }],
    "lens": "code", "notes": "" },
  { "id": "route-get-legacy-admin-tool", "surface": "routes", "element": "GET /legacy-admin-tool",
    "found_by": ["code"], "disposition": { "kind": "out-of-scope", "queue": "q-legacy-admin-tool" },
    "refs": [], "lens": "code", "notes": "not linked from nav; found only by grepping controller attributes" }
]
```

(again, the `rows` array; the other three rows in the real batch are the
same shape and are omitted here for space: `route-get-api-users` mapped to
`UM-002`, `route-post-api-password-reset` mapped to `UM-003`, and
`table-users` mapped to `UM-001`, the table backing the credentials check
UM-001 describes.)

`migrate import elements batch.json` accepts the full batch and prints
`import elements: 0 added, 5 updated, batch b-elements-disposition-001`
(upsert by id, same mechanic as any other re-import). Coverage moves from
`0/5 mapped, 0 out-of-scope, 5 unaccounted` before this batch to `4/5
mapped, 1 out-of-scope, 0 unaccounted` after it.

**An `out-of-scope` disposition's queue id is checked for existence by the
refs gate, and file it before you rely on that in a check, not after.**
`migrate check` reads the current store every time it runs; a queue id an
element names but that has no file yet is a real, present violation the
moment anything checks, not a future one. File it in the same pass:

```markdown
---
id: q-legacy-admin-tool
severity: minor
status: open
---

## Evidence

`GET /legacy-admin-tool` was found by the `code` lens (grepping controller
attributes) but not by `nav` (it has no menu entry, no link anywhere in
Startup.cs's route registrations). No FR describes it.

## Options

(a) Carry it forward as-is. (b) Mark it out of scope as dead code. (c) Ask
the operator whether anything still calls it.

## Recommendation

Recommend (b); an endpoint with no nav entry and no citation anywhere else
in the source reads as abandoned, not hidden-but-load-bearing.
```

`migrate queue add q-legacy-admin-tool.md` accepts this and prints `queue
add: q-legacy-admin-tool [minor]` (queue.md covers the grammar this file
must satisfy). Only after this does the coverage line above hold up against
a real `check`, not merely against the batch import that produced it.

### The business-rule lens: rule-sweep

**A `rule-sweep` census records a deliberate search, per capability, for
code-enforced rules that no CRUD-shaped requirement already captured.**
Balance: `found == as_requirements + queued.length`. It has no `directions`
field and no bound: it is a sweep, not a two-direction enumeration, so
nothing here asks it to dedupe across independent counting methods the way
a lens or an attribute census does.

A worked example: `AuthController.cs:8` carries `// TODO: lock the account
after 5 failed attempts; not implemented yet` directly above `Login`. The
sweep found it; it cannot become a requirement describing current behavior
because it is explicitly not implemented, so it goes to the queue instead.

```json
{
  "kind": "rule-sweep",
  "subject": "user-management",
  "phase": "extract",
  "probes": 3,
  "found": 1,
  "as_requirements": 0,
  "queued": ["q-account-lockout-scope"],
  "batch": "b-rules-um-001"
}
```

`migrate census rule-sweep.json` accepts this and prints `census: recorded
rule-sweep:user-management`. An imbalanced record is rejected with the
specific numbers named: submitting `found: 2` against the same
`as_requirements`/`queued` reports `rule-sweep census for user-management
does not balance: found 2 but as_requirements 0 + queued 1 = 1`, run
against a real store.

File the queue item this record names, in the same pass, even though (the
attribute section below explains why) no gate will ever check that you
did:

```markdown
---
id: q-account-lockout-scope
severity: moderate
status: open
---

## Evidence

`Controllers/AuthController.cs:8` carries a `TODO: lock the account after 5
failed attempts; not implemented yet` comment directly above `Login`. The
rule-sweep found this as a probe hit; it is not implemented, so it cannot
become a requirement describing current behavior, and it duplicates the
same open question `q-users-islocked-semantics` (below) raises about the
`IsLocked` column.

## Options

(a) Write it as a requirement for the target anyway, since it is documented
intent. (b) Leave it out of scope entirely; the legacy system never enforced
it. (c) Fold it into `q-users-islocked-semantics` and let the operator rule
on both at once.

## Recommendation

Recommend (c); both items are one open question (does lockout exist or
not), not two.
```

`migrate queue add q-account-lockout-scope.md` accepts this and prints
`queue add: q-account-lockout-scope [moderate]`.

**A rule-sweep with nothing to report still needs a record**, the same
zero-findings discipline enumerate.md states for a lens: `probes: N,
found: 0, as_requirements: 0, queued: []` is a real, closeable record, not
a reason to skip writing one.

### The attribute lens

**The lens contract from enumerate applies one level down, to any surface
with sub-elements: table to columns, report to parameters, screen to
fields, endpoint to parameters.** An `attribute` census needs at least two
independent directions, each naming its evidence, exactly like a `lens`
census, and `total` is bounded the same way:
`max(directions) <= total <= sum(directions)`. Balance:
`explained + queued.length == behavioral`.

**The exemption list is judgment this manual holds, not code: identity
keys, audit stamps, and tenant discriminators are exempt from
`behavioral`.** A column that only exists to be a primary key, or to record
who created or last touched a row and when, or to say which tenant a row
belongs to, carries no behavior of its own to explain; counting it toward
`behavioral` would demand an "explanation" for something that has none.
Nothing enforces this list in code, the same way enumerate.md's naming
convention for skipped elements is a convention rather than a check: two
different agents can disagree about whether a given column is exempt, and
the tool has no opinion either way.

A worked example, run against a real store. The `Users` table has five
columns: `Id` (identity key, exempt), `Email`, `PasswordHash`, `CreatedAt`
(audit stamp, exempt), and `IsLocked`. The `ddl` direction counted all five
from the `CREATE TABLE` statement; `entity` counted four properties on the
EF entity class (one column has no mapped property). `Email` and
`PasswordHash` are both explained by UM-001 directly; `IsLocked` is neither
exempt nor explained by anything on record, and the account-lockout comment
that `q-account-lockout-scope` already raised makes its real semantics an
open question, not a settled one, so it is queued rather than guessed at.

```json
{
  "kind": "attribute",
  "surface": "tables",
  "subject": "table-users",
  "phase": "extract",
  "directions": {
    "ddl": { "count": 5, "evidence": "column list from CREATE TABLE Users" },
    "entity": { "count": 4, "evidence": "properties on the EF User entity class" }
  },
  "total": 5,
  "behavioral": 3,
  "explained": 2,
  "queued": ["q-users-islocked-semantics"],
  "batch": "b-attr-users-001"
}
```

`migrate census attr-table-users.json` accepts this and prints `census:
recorded attribute:table-users`. The same shape failures the lens census
enforces apply here too, run against a real store: the old bare-count
shape (`"directions": {"ddl": 8, "entity": 7}`) is rejected by name on both
fields at once (`directions.ddl uses the old bare-count shape...`), a
single direction is rejected (`directions needs at least two independent
directions; the lens contract does not admit a single-direction
enumeration`), and an imbalanced record is rejected naming the exact
mismatch (`attribute census for table-users does not balance: behavioral 3
but explained 1 + queued 1 = 2`).

File the item this record names, the same as rule-sweep's above:

```markdown
---
id: q-users-islocked-semantics
severity: moderate
status: open
---

## Evidence

The `Users` table's `IsLocked` column is not an identity key, an audit
stamp, or a tenant discriminator, so it is not on the attribute lens's
exemption list, and it is not written or read anywhere in
`AuthController.cs`. The `Login` method's own comment says account lockout
"is not implemented yet."

## Options

(a) Treat it as dead state and drop it from the target schema. (b) Treat it
as a real but unenforced rule and implement lockout in the target. (c) Ask
the operator which one matches actual production behavior.

## Recommendation

Recommend (c); the column and the comment disagree about whether lockout
exists, and only the operator can say which one is true today.
```

`migrate queue add q-users-islocked-semantics.md` accepts this and prints
`queue add: q-users-islocked-semantics [moderate]`.

**The honest limit: nothing checks that every attribute-bearing element
actually got an attribute census, or that every capability actually got a
rule-sweep.** Verified on a disposable copy of the store: stripping both
kinds of record out of `census.jsonl` there still passes `migrate check`
clean, because gate 2 only
tracks completeness for `lens` (against `[surfaces].types`) and `closer`
(against `[closers].set`); `attribute` and `rule-sweep` records are
balance-checked when present but never counted against any declared list.
Doing the sweep for every capability and the attribute pass for every
table, report, and screen with sub-elements is this manual's discipline,
not the tool's gate, the same way the closer set below is enforced by name
and these two kinds are not.

### The declared closer set

**Every closer in `[closers].set` needs exactly one `closer` census
record; a declared closer with no record fails the gate by name.** Balance:
`findings == fixed + queued.length`. `checked` is informational and may be
zero: a closer that genuinely finds nothing to check in a small or
single-capability run still closes with a real record, not a skip.

The default three, and what each looks for:

- **cross-capability-workflow.** A user journey that spans more than one
  capability (checkout touching a cart capability, a payment capability,
  and an inventory capability) can get lost when capabilities are mined
  independently, each agent seeing only its own slice. This closer checks
  for exactly that seam.
- **scope-injection.** An FR that claims more than its citations actually
  support: configurable multi-factor authentication written up as a
  requirement when the source only ever shows a password check. This
  closer checks every FR against what it cites, not against what sounds
  plausible.
- **read-write-symmetry.** Every write path should have a matching read or
  verification path, and vice versa. A write with no matching read is
  worth naming even when it might turn out to be a false alarm (the
  verification endpoint exists somewhere this pass did not look), because
  the alternative is a defect nobody ever went looking for.

Three worked examples, run against the same real store, one per closer,
each closing on the shape its own finding actually took: no finding at
all, a finding fixed on the spot, and a finding that needed the queue.

**cross-capability-workflow finds nothing here, and that is a real,
closeable answer, not a skip.** This run has exactly one capability
(`user-management`), so no workflow inside it can possibly cross into a
second one; a closer whose whole job is catching a cross-capability seam
correctly reports zero findings on a single-capability run, checked or not.

```json
{
  "kind": "closer",
  "closer": "cross-capability-workflow",
  "phase": "extract",
  "checked": 2,
  "findings": 0,
  "fixed": 0,
  "queued": [],
  "batch": "b-closer-cross-capability-001"
}
```

`migrate census closer-cross-capability.json` accepts this and prints
`census: recorded closer:cross-capability-workflow`.

**scope-injection catches a finding and fixes it on the spot, no queue
needed.** A draft of UM-003 originally asserted that the reset token
expires after 15 minutes; nothing in `AuthController.cs` shows any
expiry logic at all, so the closer flagged the claim and the sentence was
trimmed out of the requirement before it was ever imported. `fixed` records
exactly this: a finding this pass could resolve itself, without an owner.

```json
{
  "kind": "closer",
  "closer": "scope-injection",
  "phase": "extract",
  "checked": 3,
  "findings": 1,
  "fixed": 1,
  "queued": [],
  "batch": "b-closer-scope-injection-001"
}
```

`migrate census closer-scope-injection.json` accepts this and prints
`census: recorded closer:scope-injection`.

**read-write-symmetry finds something it cannot resolve itself, so it goes
to the queue.** `ResetPassword` writes a reset token and emails it, but no
controller in the checkout reads or verifies a submitted token.

```json
{
  "kind": "closer",
  "closer": "read-write-symmetry",
  "phase": "extract",
  "checked": 3,
  "findings": 1,
  "fixed": 0,
  "queued": ["q-reset-token-verify-missing"],
  "batch": "b-closer-read-write-symmetry-001"
}
```

`migrate census closer-read-write-symmetry.json` accepts this and prints
`census: recorded closer:read-write-symmetry`. A closer record must
declare `"phase": "extract"`; declaring anything else is rejected at write
time, by name, the mirror image of the lens/`enumerate` constraint
enumerate.md documents: `closer census must declare phase "extract", the
only phase gate 10 (run-state) checks its batch against; found
"enumerate"`.

File the item this closer named:

```markdown
---
id: q-reset-token-verify-missing
severity: critical
status: open
---

## Evidence

`read-write-symmetry` checked every write path against a matching read
path. `ResetPassword` writes a reset token via `GenerateResetToken` and
emails it, but no controller in the source reads or verifies a submitted
token: there is no `POST /api/password-reset/confirm` or equivalent. Either
the verification endpoint exists somewhere this pass did not look, or reset
tokens are issued and never checked.

## Options

(a) Widen the search (other controllers, an area folder, a separate
service) before concluding it is missing. (b) Treat it as a real gap and
flag it for the target to fix, not replicate. (c) Ask the operator directly
whether reset ever worked end-to-end in production.

## Recommendation

Recommend (c); a write with no matching read is exactly what this closer
exists to catch, and only the operator can say whether it is a real defect
or evidence this pass has not looked far enough yet.
```

`migrate queue add q-reset-token-verify-missing.md` accepts this and
prints `queue add: q-reset-token-verify-missing [critical]` (queue.md's
own worked grammar example is built on this exact file).

A declared closer with no record at all fails `census`, run on a
disposable copy with extract reset before any closer census was recorded
(never reset the running example itself just to see this message):

```
census:
    declared closer cross-capability-workflow has no census record
    declared closer scope-injection has no census record
    declared closer read-write-symmetry has no census record
```

### Workflow tracing

A requirement should describe a whole user journey, not stop at the first
method that handles part of it. `Login` validates credentials and issues a
token; a real workflow trace follows that token forward to whatever
subsequently checks it, not just the one method that mints it. On a larger
source, one journey routinely crosses more than one controller, or a
controller and a background job together; cross-capability-workflow above
is exactly the closer that catches a journey mined this way and split
across two agents' capabilities without anyone noticing the seam.

## What closes it

Every capability mined, every element disposed, every declared closer
recorded, every queue item this phase's own findings named already filed
(above). `migrate check --phase extract` will not read as clean mid-run,
which is expected: the census gate reads the whole store regardless of
`--phase`, so it still names every surface this scratch run never
enumerated (`jobs`, `reports`, `screens`, `integrations`, `workflows`,
`settings`). `refs` does not appear below only because `q-legacy-admin-tool`
was already filed above; skip that step and it reappears here, naming
`route-get-legacy-admin-tool`, exactly the way enumerate.md's and seam.md's
own noisy-but-expected checks name what is genuinely still missing rather
than padding the count. Run `migrate check --phase extract` for real,
right before flipping the phase, against a store with exactly the rows
this manual's examples built:

```
4/5 mapped, 1 out-of-scope, 0 unaccounted

Violations (10):
  census:
    declared surface jobs has no lens census record; the lens did not run or did not close
    declared surface reports has no lens census record; the lens did not run or did not close
    declared surface screens has no lens census record; the lens did not run or did not close
    declared surface integrations has no lens census record; the lens did not run or did not close
    declared surface workflows has no lens census record; the lens did not run or did not close
    declared surface settings has no lens census record; the lens did not run or did not close
  parity:
    UM-001 has no parity plan
    UM-002 has no parity plan
    UM-003 has no parity plan
  run-state:
    phase extract is running; every phase through extract must be done
```

The `parity` lines are expected too, for the same reason enumerate.md and
seam.md give for their own noisy mid-run checks: assigning an oracle is
phase 4's job, and the `run-state` line clears the moment the phase is
flipped, not before. Once every capability is mined and every declared
closer has closed, flip it:

```
migrate phase extract --status done
```

## Degradation

- **No recipe for the detected stack.** Contract-only, exactly as in
  enumerate: derive your own attribute directions and rule-sweep probes;
  the census still gates identically.
- **No runtime environment.** The evidence trust order loses its top tier;
  confidence rests on `code`, `nav`, and `docs` alone, and a behavior only
  a live run could confirm is `inferred` at best, never `confirmed`.
- **A rule-sweep or attribute census with nothing to report.** Record that
  fact explicitly, the same zero-findings discipline as a lens: a real
  record with zero counts, not a skipped one.
- **A declared closer that finds nothing to check.** `checked: 0, findings:
  0` is a valid, closeable record for a closer that genuinely does not
  apply at this run's current scale, not a reason to omit it.

## Commands

```
migrate import reqs <batch.json>
migrate import elements <batch.json>
migrate census <record.json>
migrate queue add <item.md>
migrate phase extract --status done
```
