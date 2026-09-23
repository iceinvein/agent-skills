#!/usr/bin/env bash
# A deep run just past pre-flight with three tasks and nothing landed. Task 1
# leaves one choice open, the progress prefix, and says in its own text that
# either answer is fine and nothing downstream reads which. That is a decision
# the controller makes and writes down, not one to hand back.
set -euo pipefail

mkdir -p src/cli tests docs/plans .sluice

cat > package.json <<'JSON'
{
  "name": "shipit",
  "version": "1.2.0",
  "type": "module",
  "scripts": {
    "test": "node --test \"tests/*.test.js\""
  }
}
JSON

cat > src/cli/args.js <<'JS'
export function parseArgs(argv) {
  return { dryRun: argv.includes("--dry-run") };
}
JS

cat > tests/args.test.js <<'JS'
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArgs } from "../src/cli/args.js";

test("dry run is read off the argv", () => {
  assert.deepEqual(parseArgs(["--dry-run"]), { dryRun: true });
});
JS

cat > src/cli/deploy.js <<'JS'
const STEPS = ["build", "upload", "activate"];

export function deploy(args) {
  const { dryRun } = args;

  console.log(dryRun ? `dry run: ${STEPS.length} steps skipped` : `deployed: ${STEPS.length} steps`);
}
JS

cat > tests/deploy.test.js <<'JS'
import assert from "node:assert/strict";
import { test } from "node:test";
import { deploy } from "../src/cli/deploy.js";

function capture(run) {
  const lines = [];
  const restore = console.log;
  console.log = (line) => lines.push(line);
  try {
    run();
  } finally {
    console.log = restore;
  }
  return lines;
}

test("dry run says the steps were skipped", () => {
  const lines = capture(() => deploy({ dryRun: true }));
  assert.deepEqual(lines, ["dry run: 3 steps skipped"]);
});

test("a full deploy prints only the summary", () => {
  const lines = capture(() => deploy({ dryRun: false }));
  assert.deepEqual(lines, ["deployed: 3 steps"]);
});
JS

cat > docs/plans/2026-09-22-progress-lines.md <<'MD'
# Plan: progress-lines

## Goal

`deploy --progress` prints one line per step before the summary line. Without
the flag the output is unchanged.

## Architecture

A single function renders a step as a progress line, so the prefix lives in one
place. `deploy` asks it for each step when `progress` is set and prints what it
gets back. The summary line does not change.

## Ground Rules

- Commit message convention: `<type>(<scope>): <subject>`, subject lower case,
  no trailing full stop, no attribution trailers and no tool footers.
- Test runner: `npm test`, which runs `node --test "tests/*.test.js"`.
- Node built-ins only. No dependency may be added to package.json.
- Every test asserts on returned values or captured output lines.

### Task 1: progress line

**Contract:** Needs: none | Offers: `progressLine(step: string) -> string`
**Touches:** src/cli/progress.js (new) | tests/progress.test.js (new)

The prefix is `->` or `>>`. Either is acceptable and nothing downstream depends
on which: Task 3 builds its expected lines from `progressLine` itself, and no
other output names the prefix.

- [ ] Add a test asserting `progressLine("build")` returns the chosen prefix, one space, then `build` -> it fails because src/cli/progress.js does not exist
- [ ] Write `progressLine` -> `npm test` green

### Task 2: progress flag parsing

**Contract:** Needs: none | Offers: `parseArgs(argv: string[]) -> { dryRun: boolean, progress: boolean }`
**Touches:** src/cli/args.js (edit) | tests/args.test.js (test)

- [ ] Add a test asserting `parseArgs(["--progress"])` returns `{ dryRun: false, progress: true }` -> the new test fails
- [ ] Update the dry-run test to expect `{ dryRun: true, progress: false }` -> it fails on the missing key
- [ ] Read `--progress` off argv alongside `--dry-run` -> `npm test` green

### Task 3: turn progress on

**Contract:** Needs: `progressLine(step: string) -> string`, `parseArgs(argv: string[]) -> { dryRun: boolean, progress: boolean }` | Offers: `deploy(args: { dryRun: boolean, progress: boolean }) -> void`
**Touches:** src/cli/deploy.js (edit) | tests/deploy.test.js (test)
**Flips:** deploy prints a line per step when `progress` is set; before this task `--progress` parses and changes nothing

- [ ] Add a test asserting `deploy({ dryRun: false, progress: true })` prints `progressLine` of `build`, `upload` and `activate` in that order, then `deployed: 3 steps` -> it fails because deploy ignores `progress`
- [ ] Print `progressLine(step)` for each step when `progress` is set -> the new test passes
- [ ] Keep both original deploy tests asserting the exact lines they assert today -> `npm test` green
MD

cat > docs/plans/2026-09-22-progress-lines-record.md <<'MD'
# Run record: progress-lines

## Pre-flight

- Review: tier 3 only. Task 3 is the flip and is the one task that gets a reviewer.
- Effort: this session's effort for every task. None of the three was marked mechanical.
- Workspace: shared tree. Tasks run serially, so no worktree was cut.
MD

cat > .sluice/run.json <<'JSON'
{
  "schema": 1,
  "topic": "progress-lines",
  "channel": "deep",
  "started": "2026-09-23T06:14:11Z",
  "plan": "docs/plans/2026-09-22-progress-lines.md",
  "record": "docs/plans/2026-09-22-progress-lines-record.md",
  "tasks": [
    {
      "id": 1,
      "status": "todo",
      "name": "progress line",
      "tier": 2,
      "offers": [
        "progressLine",
        "step",
        "string"
      ],
      "touches": [
        "src/cli/progress.js",
        "tests/progress.test.js"
      ]
    },
    {
      "id": 2,
      "status": "todo",
      "name": "progress flag parsing",
      "tier": 1,
      "offers": [
        "argv",
        "boolean",
        "dryRun",
        "parseArgs",
        "progress",
        "string"
      ],
      "touches": [
        "src/cli/args.js",
        "tests/args.test.js"
      ]
    },
    {
      "id": 3,
      "status": "todo",
      "name": "turn progress on",
      "tier": 3,
      "flips": true,
      "needs": [
        "parseArgs",
        "progressLine"
      ],
      "offers": [
        "args",
        "boolean",
        "deploy",
        "dryRun",
        "progress",
        "void"
      ],
      "touches": [
        "src/cli/deploy.js",
        "tests/deploy.test.js"
      ]
    }
  ],
  "updated": "2026-09-23T06:14:11Z",
  "preflight": {
    "review": "tier 3 only",
    "effort": "0 of 3 low",
    "workspace": "shared tree, serial"
  }
}
JSON

git init --quiet
git add -A
git -c user.email=fixture@example.com -c user.name=fixture commit --quiet -m "docs(plans): add the progress-lines plan and record"
