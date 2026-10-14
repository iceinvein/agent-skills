# Findings format

Every run writes `report.md` and `findings.json` to
`.bug-hunter/<YYYY-MM-DD>-<slug>/`, next to `intent.md` and `scenarios.md`.
They carry the same content; `findings.json` is the one a grader or a calling
skill parses, so it follows this shape exactly.

Write both files with the Write tool, passing the full contents. Do not build
them with a shell command, a heredoc or a script (`python3 -c` with
`json.dump`, `node -e` with `JSON.stringify`): a grader reading the run's trace
sees a script, not the JSON it produced.

## findings.json

```
{ "target": string, "intent": { "id": string, "claim": string, "source": string }[], "bugs": { "id": string, "scenario": string, "claim": string, "expected": string, "observed": string, "repro": { "files": Record<string,string>, "cmd": string } }[], "ambiguities": { "id": string, "scenario": string, "question": string }[], "covered": { "scenario": string, "claim": string }[] }
```

Field by field:

- `target`: the one-line target description the run started from (a commit,
  range or paths).
- `intent`: the claims from `intent.md`. `id` is the claim's number (`I1`),
  `claim` its text, `source` where it came from (file and line, commit SHA, or
  `request`). A claim taken from a sibling implementation or a stated
  invariant cites the file and line that holds it. A result wrong under every
  reading (SKILL.md) has `source` `baseline`.
- `bugs`: confirmed findings only. `id` numbers them (`B1`). `scenario` is
  the scenario's id from `scenarios.md` and its one-line label, as
  `"<id>: <label>"`, for example `"S4: quantity of exactly the cap is
  accepted"`. A reader that sees only this field must still know what was
  tested, so never give the bare id. `claim` is the violated intent id.
  `expected` and `observed` are the values the repro asserted and got.
- `repro.files`: paths relative to the repo root, each mapped to the file's
  full contents, so a grader can write them into a fresh checkout and run
  `repro.cmd` from the root. Include every file the repro needs that is not
  already in the tree; an edited existing file is given in full, not as a
  patch.
- `repro.cmd`: a command run from the repo root that runs this repro alone and
  exits non-zero while the bug is present.
- `ambiguities`: `id` numbers them (`A1`); `scenario` is `"<id>: <label>"`,
  as in `bugs`; `question` is what product has to decide.
- `covered`: scenarios that ran and passed. `scenario` is `"<id>: <label>"`,
  as in `bugs`; `claim` the intent id it checked.

Empty buckets are empty arrays, never omitted. Rejected findings and
exploratory tests appear nowhere in the file.

## report.md

```markdown
# Bug hunt: <target>

<date>. Run directory: `.bug-hunter/<YYYY-MM-DD>-<slug>/`.
<n> bugs, <n> ambiguities, <n> covered. <scenarios not executed, and why, or "All scenarios executed.">

## Bugs

### B1: <one-line summary>

- Scenario: S4, <scenario text>
- Violates: I2, "<claim text>" (<source>)
- Expected: <value>
- Observed: <value>
- Repro: `<path>` (and any others), run with `<cmd>`

## Ambiguities

### A1: <question>

- Scenario: S7, <scenario text>
- Why it is open: <the claims are silent, or I3 and I5 disagree>

## Covered

| Scenario | Claim |
|---|---|
| S1, <scenario text> | I1 |
```

A bucket with no entries keeps its heading with the line `None.` under it, so
a reader can tell "none found" from "section missing".
