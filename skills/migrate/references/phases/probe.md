# Phase 0: Probe

## Purpose

Detect the source stack, detect whether the source is runnable, interview for
the target profile, and confirm the surface set this run will enumerate.
Write `.migrate/config.toml` and `.migrate/parity-basis.md`. Every later phase
reads `config.toml`; deciding the runtime basis here means the enumerate
phase never has to re-check it, and no phase after this one probes the
source's runnability again.

Exit condition: `config.toml` exists, `parity-basis.md` carries the
detection evidence as prose, and `migrate phase probe --status done` has
run.

## Inputs

There is no `config.toml` and no store yet; this phase writes the first one.
`migrate init` refuses at exit 1 if `.migrate/config.toml` already exists, so
re-running probe on a live store means editing the file directly, not
re-running `init`.

What you read instead:

- The source checkout itself (read-only): manifest and build files,
  dependency lockfiles, a `.git` directory or its absence, README and any
  docs tree.
- The target repo: it must already be a git working copy (the store commits
  inside it), and whatever `.gitignore` it already has.
- The operator: the target profile is an interview, not something detectable
  from the source.

## Procedure

1. **Detect the source stack.** Read the manifest and build files. If
   nothing in the checkout names a stack you can commit to, record
   `unknown` rather than guessing. `unknown` is a valid value, not a failure:
   it is what routes the enumerate phase into contract-only mode instead of
   into the wrong stack's recipe, which is worse than no recipe at all.

2. **Detect whether the source is runnable.** Try to install dependencies,
   build, and start it, in whatever order the stack suggests. Write every
   probe command you ran and its actual output to `.migrate/parity-basis.md`
   as prose, along with any dependency gap or environmental blocker you hit.
   This is prose, not a census record, because it is an argument for the
   basis you are about to declare, not a count anything can balance. Decide
   `runnable` or `source-only` from that evidence and pass it to `--basis`.

3. **Interview for the target profile.** Ask for: a name, the target stack,
   the layout (which directories hold which part of the target), the
   commands that test, lint, and build it, and `parity_test_path` (the path
   template later phases will write parity tests under, for example
   `tests/parity/{capability}/{fr_slug}.test.ts`).

4. **Confirm or replace the default surface set.** The default is
   `["routes", "tables", "jobs", "reports", "screens", "integrations",
   "workflows", "settings"]`. This is written by `migrate init` and is not
   yours to change through a flag: `init` takes no surface-set argument at
   all. If the default fits the source, leave it. If it does not, this is
   the single largest source-genericity lever in the whole tool, and it
   costs one config key. A COBOL source, for example, declares:

   ```toml
   [surfaces]
   types = ["programs", "copybooks", "jcl-jobs", "bms-maps", "datasets"]
   ```

   Hand-edit `[surfaces].types` in `config.toml` to replace it. Every
   downstream gate reads the declared set, not the default, so this one edit
   is what makes the rest of the run track a non-.NET source honestly
   instead of forcing it through a shape that does not fit.

   Element ids derive from the surface name with a trailing `s` stripped
   (`tables` -> `table-...`). If a declared surface is already singular but
   ends in `s` anyway (`status`, stripped naively to `statu-...`), add an
   entry to `[surfaces.singular]` to override it, for example
   `status = "status"`. `enumerate.md`'s Inputs section reads this table
   when it derives ids; probe is the only phase that ever writes
   `config.toml`, so an override missed here has no later phase to catch it
   in.

   `[target.layout]` and `[target.commands]` have the same property:
   `init` writes them as an empty table and three placeholder `echo`
   commands respectively, and nothing else fills them in. Hand-edit the
   interview answers from step 3 into both before enumerate starts.
   `target.parity_test_path` is different: `init` already writes a real
   default, `tests/parity/{capability}/{fr_slug}.test.ts`, not a
   placeholder, so it needs no edit when the operator's answer matches it.
   When it does not (a different path convention, a different test file
   extension), hand-edit `target.parity_test_path` in `[target]` the same
   way, since nothing else will. Neither `SKILL.md` nor `docs/reference.md`
   names this field, so this paragraph is its only documented home; the
   parity phase is what reads it back.

## What closes it

There is no census kind for probe; it is not a lens, an attribute, a
rule-sweep, or a closer, so nothing balances here. The phase closes on the
artifacts existing and the status flip:

```
migrate init --source /abs/path/to/legacy --scope "user management module" \
  --name nexus-workforce --source-stack aspnet-webforms \
  --target-stack "dotnet-10 + vue3" --basis runnable
migrate phase probe --status done
```

`init` exits 1 if `config.toml` already exists, and 2 if `--source` is
missing, is not a directory, or `--basis` is not `runnable` or
`source-only`. Confirm the write with `migrate status`, which prints the
detected stack and basis on its first line.

Running `migrate check --phase probe` here will not come back clean: the
census gate reads the whole store regardless of `--phase`, so it reports
every declared surface's lens record and every declared closer's record as
missing, correctly, because none of them exist yet. That is not a probe
defect; it is the same "gates that are neither run-state nor phase-scoped
read the whole store" behavior `SKILL.md` describes, and it is why probe's own close is the status flip
above, not a clean `check`.

## Degradation

| Absent | Record |
|---|---|
| No VCS in the source | `vcs = "none"`. `init` detects this from the absence of `.git` and writes it for you; nothing to hand-edit. |
| No runnable environment | `basis = "source-only"`, plus the blocking evidence (missing SDK, a dependency that will not install, an environment nothing here can reach) written to `parity-basis.md`. This is the fact the runtime lens and the parity phase both read later: getting it right once here is the point of moving basis detection to phase 0 at all. |
| No documentation | Note it in `parity-basis.md` now (no `docs/` tree, no wiki export, nothing beyond a generated README). This does not close anything by itself, but it means the enumerate phase's docs lens can open with `not-applicable:no-documentation` immediately instead of re-discovering the same absence. |

## Commands

```
migrate init --source <path> --scope "<text>" --name <target> \
  [--source-stack <s>] [--target-stack <s>] [--basis <runnable|source-only>]
migrate phase probe --status done
```
