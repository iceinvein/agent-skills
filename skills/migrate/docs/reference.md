# migrate reference

Everything you need to drive the CLI without reading its source: the file
formats it accepts, the grammars inside them, what each gate enforces, and what
the exit codes mean.

For what the tool is and how to install it, see [../README.md](../README.md).
For how it is built and how to extend it, see [architecture.md](architecture.md).

## Conventions

**Exit codes.** Every command uses the same three.

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | A content or domain failure in a well-formed request. The request was serviceable and the answer is no: a gate found violations, a census does not balance, a queue file is unparseable. |
| `2` | A malformed or unusable request. The command could not begin: a missing flag value, an unknown phase, a file that is absent or not valid JSON, no store above the cwd, a config that will not load. |

The split matters because an orchestrating agent should be able to tell "your
generator is broken" from "your numbers are wrong" without parsing stderr.

**Field names are `snake_case` on disk** (`found_by`, `in_ledger`,
`as_requirements`, `owner_signed`, `parity_exclusion`). The TypeScript types
mirror them exactly so there is no serialization layer.

**Nothing writes into the source tree.** Every writer refuses a path that
resolves inside `source.path`, following symlinks and case-insensitive volumes,
and exits 2.

## Batch files

`migrate import` is the only supported way rows enter the store. It takes one
JSON file holding an envelope and an array of rows:

```json
{
  "batch": "b-routes-code-001",
  "phase": "enumerate",
  "rows": [ ... ]
}
```

- `batch` is your own id for this batch. It is written onto every row and
  recorded in `phases.json`, which is what makes a crashed run resumable.
- `phase` is one of `probe`, `enumerate`, `seam`, `extract`, `parity`, `queue`,
  `adjudicate`, `handoff`.
- Do not put a `batch` field on the rows themselves. The importer sets it.

**Import is all or nothing.** One invalid row means nothing is written, because
a partially-written batch is a store nobody can reason about on resume: the
batch id would claim rows that are not all there.

**Re-importing the same batch is safe.** Rows upsert by id, keeping their
original position, so a re-run after a crash updates rather than duplicates. A
repeated id *within a single batch* is rejected, since that is an authoring
error that would silently discard a row.

### Elements

`migrate import elements batch.json`

```json
{
  "id": "route-get-api-users",
  "surface": "routes",
  "element": "GET /api/users",
  "found_by": ["code", "nav"],
  "disposition": { "kind": "unaccounted" },
  "refs": [
    { "kind": "src", "path": "Controllers/UsersController.cs", "lines": [42, 58] }
  ],
  "lens": "code",
  "notes": ""
}
```

| Field | Rule |
|---|---|
| `id` | `<singular>-<slug>`. The singular comes from the surface name, which by default is the surface with a trailing `s` stripped, overridable per surface via `[surfaces.singular]` in config. The slug is lowercase kebab-case. |
| `surface` | Must be one of the types declared in `[surfaces].types`. |
| `element` | Free text naming the thing. Non-empty. |
| `found_by` | One or more of `code`, `nav`, `docs`, `runtime`. |
| `lens` | The single lens that produced this row, same vocabulary. |
| `disposition` | See below. Starts `unaccounted`. |
| `refs` | Array of refs, may be empty. |
| `notes` | Free text, may be empty. |

Because element ids derive from the surface, a surface that is already singular
but ends in `s` (for example `status`) needs an explicit
`[surfaces.singular]` override, or ids will be built from `statu`.

### Requirements

`migrate import reqs batch.json`

```json
{
  "id": "UM-001",
  "cap": "user-management",
  "requirement": "User must provide a valid email and password to log in",
  "actors": "User",
  "objects": "Credentials",
  "rules": "Email validated per RFC 5322, password minimum 8 characters",
  "origin": "intended",
  "confidence": { "kind": "confirmed" },
  "citations": [
    { "kind": "ledger", "id": "route-post-api-login" },
    { "kind": "src", "path": "Controllers/AuthController.cs", "lines": [20, 35] }
  ],
  "parity": { "kind": "rubric", "level": "high" }
}
```

| Field | Rule |
|---|---|
| `id` | Free-form, conventionally `<NS>-<number>`. Must be unique across the store. |
| `cap` | Must match a `slug` in `capabilities.jsonl`. |
| `requirement` | Non-empty. |
| `actors`, `objects`, `rules` | Free text, default to `-` if omitted. |
| `origin` | `intended` or `accidental-candidate`. |
| `confidence` | See below. |
| `citations` | **At least one required.** This is the never-fabricate rule made structural. |
| `parity` | See below, or `null` while unplanned. |

### Deltas

`migrate import deltas batch.json`

```json
{
  "id": "delta-multi-tenancy",
  "scope": "All database tables",
  "rationale": "SaaS model requires tenant isolation",
  "parity_exclusion": "Schema comparisons ignore the TenantId column",
  "validation": "Cross-tenant leak tests prove isolation",
  "owner_signed": null
}
```

`id` must start with `delta-`. All four text fields are required and non-empty.
`owner_signed` is a date string or `null`; the gate fails while any delta is
unsigned, which is what stops exclusions accreting silently.

### Capabilities

`capabilities.jsonl` has **no import path in this milestone**. Write it
directly, one JSON object per line:

```json
{"slug": "user-management", "title": "User Management", "ns": "UM", "elements": []}
```

Because hand-editing is the only route, the gate checks for duplicate slugs
explicitly.

## Grammars

These discriminated unions appear inside rows. The `kind` field selects the
variant; unknown kinds are rejected.

**Ref** (used by `refs` and `citations`)

```json
{ "kind": "src", "path": "Controllers/Auth.cs", "lines": [20, 35] }
{ "kind": "ledger", "id": "route-post-api-login" }
{ "kind": "doc", "path": "docs/user-guide.pdf", "note": "page 37" }
{ "kind": "observed", "host": "legacy.example.com", "path": "/Settings", "behavior": "toggle renders" }
```

`lines` is optional; when present it must be `[start, end]` with `start <= end`.
Only `src` refs are resolved against the source tree, and only under
`--citations`. A `ledger` ref is checked by the `refs` gate instead.

**Disposition** (on elements)

```json
{ "kind": "unaccounted" }
{ "kind": "mapped", "fr": "UM-001" }
{ "kind": "out-of-scope", "queue": "q-legacy-admin-tool" }
```

**Confidence** (on requirements)

```json
{ "kind": "confirmed" }
{ "kind": "inferred" }
{ "kind": "queued", "queue": "q-invoice-batch-scope" }
```

**Parity** (on requirements, or `null`)

```json
{ "kind": "golden-master", "ref": "tests/parity/users/create.test.ts" }
{ "kind": "differential",  "ref": "tests/parity/users/list.test.ts" }
{ "kind": "rubric", "level": "high" }
{ "kind": "rubric", "level": "moderate", "queue": "q-parity-um-042" }
```

`rubric:high` needs no queue id. `moderate`, `low` and `unknown` each require
one, which is how a sub-high confidence claim stays attached to an owner
decision.

**Queue ids** are `q-` followed by a lowercase kebab-case slug. This is a format
constraint rather than a blocklist: an uppercase letter, a stray space or
trailing punctuation are all rejected because none produces a well-formed slug.

## Census records

`migrate census record.json` takes a single JSON object, not an envelope. A
census record is a lens closing its own arithmetic, and the CLI checks the sum
rather than trusting it.

Re-recording the same subject **replaces** its record rather than adding a
second, so the gate never sees two answers for one subject. Subject identity is
`lens:<surface>`, `attribute:<subject>`, `rule-sweep:<subject>` or
`closer:<closer>`.

Within `skipped` and `queued`, duplicates are rejected, compared after trimming
and case folding. Otherwise an imbalanced record could be padded into passing by
repeating an entry.

### lens

One per declared surface. This is the record the coverage claim rests on.

```json
{
  "kind": "lens",
  "surface": "tables",
  "phase": "enumerate",
  "directions": { "ddl": 43, "orm": 40 },
  "total": 45,
  "in_ledger": 44,
  "added": 1,
  "skipped": [{ "element": "__EFMigrationsHistory", "reason": "framework-owned" }],
  "queued": ["q-table-ownership-personbookinggroup"],
  "batch": "b-tables-census-001"
}
```

Balance: `total == in_ledger + added + skipped.length + queued.length`.

Additionally, `in_ledger + added` is **reconciled against the store**: it must
equal the number of elements actually carrying that surface. `total` counts what
exists in the legacy source and cannot be corroborated, but the claim about how
many rows reached the ledger is directly countable, so it is counted.

### attribute

One per subject with sub-elements: a table's columns, a report's parameters, a
screen's fields.

```json
{
  "kind": "attribute",
  "surface": "tables",
  "subject": "table-roster-days",
  "directions": { "ddl": 14, "entity": 13 },
  "total": 15,
  "behavioral": 7,
  "explained": 6,
  "queued": ["q-ros-007"],
  "batch": "b-attr-001"
}
```

Balance: `explained + queued.length == behavioral`.

### rule-sweep

One per capability, recording a search for code-enforced rules that no CRUD
requirement captured.

```json
{
  "kind": "rule-sweep",
  "subject": "user-management",
  "probes": 4,
  "found": 2,
  "as_requirements": 2,
  "queued": [],
  "batch": "b-rules-001"
}
```

Balance: `found == as_requirements + queued.length`.

### closer

One per declared closer in `[closers].set`.

```json
{
  "kind": "closer",
  "closer": "read-write-symmetry",
  "checked": 34,
  "findings": 3,
  "fixed": 2,
  "queued": ["q-sym-001"],
  "batch": "b-closer-001"
}
```

Balance: `findings == fixed + queued.length`. `checked` is informational.

## Queue items

`migrate queue add item.md` takes a markdown file whose stem matches its `id`.

```markdown
---
id: q-invoice-batch-scope
severity: moderate
status: open
---

## Evidence

Route POST /api/invoice/batch found in InvoiceController.cs:215-240.
Prod logs show 3 invocations in 6 months.

## Options

(a) Replicate as-is. (b) Harden it. (c) Mark out of scope.

## Recommendation

Recommend (c); usage suggests it is deprecated.
```

- `severity` is `critical`, `moderate` or `minor`. `queue list` sorts by that
  order, then by id.
- `status` is `open` or `adjudicated`. An adjudicated item requires a `ruling`.
- All three sections must be present and non-empty. Missing and empty produce
  distinguishable errors.
- Headings must be exactly level two at the start of a line. `### Options` is not
  a heading match, and a duplicate heading is an error rather than a silent
  first-wins.
- Headings inside fenced code blocks are ignored, so Evidence can quote code
  containing `##` lines. An unclosed fence is a loud error.
- BOM and CRLF are handled.

## The nine gates

`migrate check` reports violations grouped by gate, always in this order. Every
message names the specific offending row, path or id; there is no aggregate
"check failed".

The summary line is always printed, passing or failing:

```
612/612 mapped, 0 out-of-scope, 0 unaccounted
```

| Gate | Enforces |
|---|---|
| `coverage` | Every element has a terminal disposition. An `unaccounted` element is a violation naming its id and surface. |
| `census` | Every declared surface has a lens record and every declared closer has a closer record; every record balances; `in_ledger + added` matches the real element count for that surface. |
| `refs` | Referential integrity: a `mapped` disposition resolves to a real requirement, a queue id resolves to a real queue file, a requirement's `cap` resolves to a capability, a `ledger` citation resolves to a real element. Also catches duplicate requirement ids, capability slugs and element ids. |
| `queue` | Queue files parse and satisfy the grammar above. |
| `deltas` | No delta is left unsigned. |
| `parity` | Every requirement whose confidence is not `queued` carries a parity plan. |
| `citations` | **Opt-in, `--citations`.** Every `src` citation resolves against the source tree, with line ranges inside the file. Symlinks are followed and checked, so a link out of the tree is rejected. |
| `leaks` | **Opt-in, `--leaks`.** No value from `.migrate/.env` appears in a committed artifact or anywhere in git history. Messages name the variable and file, never the value. |
| `source` | The source checkout has no uncommitted changes, when it is a git repo. |

**`check` is strict mid-run by design.** The census gate wants a record for
every declared surface and closer, so it does not pass until a run is finished.
Grouping by gate is what lets you tell an expected mid-run gap from a real
defect.

**Two things `check` alone cannot tell you.** Citations are opt-in, so a plain
run does not verify them; and a store where nothing has happened yet, with an
all-zero census for every surface, passes at `0/0 mapped`. Use `migrate status`
to see whether a run actually started. Both are recorded as open items for the
next milestone.

## Command details

**`migrate init --source <path> --scope <text> --name <target>`**
Optional: `--source-stack`, `--target-stack`, `--basis <runnable|source-only>`.
Creates `.migrate/` and `.migrate/queue/`, writes `config.toml`, and appends
`.migrate/.env` to an existing `.gitignore` exactly once. Refuses an existing
config at 1, and a source path that is missing or not a directory at 2. Values
you pass are escaped, so a scope containing quotes or backslashes round-trips
intact. `vcs` is detected from the presence of `.git` in the source.

**`migrate reset --phase <phase>`**
Clears only what that phase owns: `enumerate` clears elements and lens census
records; `seam` clears capabilities, `seam.json` and `seam.md`; `extract` clears
requirements, the attribute, rule-sweep and closer census records, and returns
every element disposition to `unaccounted`; `parity` clears deltas and nulls
every requirement's parity. Other phases reset state only. **Queue items are
never cleared by any phase.**

**`migrate report [--out <dir>]`**
Writes `ledger.md`, `requirements.md` and `queue.md`, defaulting to
`docs/migrate/`. Generated files, each carrying a banner saying so. Cell content
is escaped so free text containing pipes or newlines cannot break a table.

**`migrate status`**
Read-only. Phase state, store counts, the gate summary line, and a resume
pointer naming the first non-done phase and its last recorded batch.
