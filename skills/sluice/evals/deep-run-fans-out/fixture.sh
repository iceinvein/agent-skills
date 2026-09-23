#!/usr/bin/env bash
# A deep run just past pre-flight with four tasks and nothing landed. The first
# three have disjoint Touches and no Needs between them, and pre-flight bought a
# worktree per concurrent implementer, so the graph and the answer both say
# they go at once. The flip needs all three and runs alone after them.
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

  for (const step of STEPS) {
    console.log(`-> ${step}`);
  }

  console.log(dryRun ? "dry run: 3 steps skipped" : "deployed: 3 steps");
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

test("dry run skips the steps and says so", () => {
  const lines = capture(() => deploy({ dryRun: true }));
  assert.equal(lines.at(-1), "dry run: 3 steps skipped");
});

test("a full deploy reports every step", () => {
  const lines = capture(() => deploy({ dryRun: false }));
  assert.deepEqual(lines, ["-> build", "-> upload", "-> activate", "deployed: 3 steps"]);
});
JS

cat > docs/plans/2026-09-22-step-timings.md <<'MD'
# Plan: step-timings

## Goal

`deploy --timings` appends each step's duration to its progress line, so
`-> build` becomes `-> build (12ms)`. Without the flag every line is unchanged,
and the summary line is unchanged either way.

## Architecture

Tasks 1 to 3 are three inert pieces that nothing calls yet: a duration
formatter, the flag, and a stopwatch driven by an injected clock. None of them
needs another. Task 4 is the flip: `deploy` takes the clock as a second
parameter and, when `timings` is set, prints each step with its duration.

## Ground Rules

- Commit message convention: `<type>(<scope>): <subject>`, subject lower case,
  no trailing full stop, no attribution trailers and no tool footers.
- Test runner: `npm test`, which runs `node --test "tests/*.test.js"`.
- Node built-ins only. No dependency may be added to package.json.
- Every test injects its clock; no test reads the real time.

### Task 1: duration formatter

**Contract:** Needs: none | Offers: `formatDuration(ms: number) -> string`
**Touches:** src/cli/duration.js (new) | tests/duration.test.js (new)

- [ ] Add a test asserting `formatDuration(12)` returns `12ms` and `formatDuration(999)` returns `999ms` -> it fails because src/cli/duration.js does not exist
- [ ] Add a test asserting `formatDuration(1500)` returns `1.5s` -> it fails for the same reason
- [ ] Write `formatDuration`: whole milliseconds under 1000, seconds to one decimal place from 1000 up -> `npm test` green

### Task 2: timings flag parsing

**Contract:** Needs: none | Offers: `parseArgs(argv: string[]) -> { dryRun: boolean, timings: boolean }`
**Touches:** src/cli/args.js (edit) | tests/args.test.js (test)

- [ ] Add a test asserting `parseArgs(["--timings"])` returns `{ dryRun: false, timings: true }` -> the new test fails, the existing dry-run test still passes
- [ ] Update the dry-run test to expect `{ dryRun: true, timings: false }` -> it fails on the missing key
- [ ] Read `--timings` off argv alongside `--dry-run` -> `npm test` green

### Task 3: stopwatch

**Contract:** Needs: none | Offers: `createStopwatch(now: () => number) -> { lap(): number }`
**Touches:** src/cli/stopwatch.js (new) | tests/stopwatch.test.js (new)

- [ ] Add a test with a fake clock returning 100, 112, 150 asserting two `lap()` calls return 12 then 38 -> it fails because src/cli/stopwatch.js does not exist
- [ ] Write `createStopwatch`: read `now()` once at creation, and have `lap()` return the milliseconds since the previous reading -> `npm test` green

### Task 4: turn timings on

**Contract:** Needs: `formatDuration(ms: number) -> string`, `parseArgs(argv: string[]) -> { dryRun: boolean, timings: boolean }`, `createStopwatch(now: () => number) -> { lap(): number }` | Offers: `deploy(args: { dryRun: boolean, timings: boolean }, now: () => number) -> void`
**Touches:** src/cli/deploy.js (edit) | tests/deploy.test.js (test)
**Flips:** step lines carry their duration when `timings` is set; before this task `--timings` parses and changes nothing

- [ ] Add a test calling `deploy({ dryRun: false, timings: true }, now)` with a fake clock returning 0, 10, 30, 1530 and asserting the lines `-> build (10ms)`, `-> upload (20ms)`, `-> activate (1.5s)`, `deployed: 3 steps` -> it fails because deploy ignores `timings`
- [ ] Give `deploy` the `now` parameter, defaulting to `Date.now`, and when `timings` is set print each step as `-> <step> (<formatDuration of one stopwatch lap>)` -> the new test passes
- [ ] Keep both original deploy tests asserting the exact lines they assert today -> `npm test` green
MD

cat > docs/plans/2026-09-22-step-timings-record.md <<'MD'
# Run record: step-timings

## Pre-flight

- Review: tier 3 only. Task 4 is the flip and is the one task that gets a reviewer.
- Effort: this session's effort for every task. None of the four was marked mechanical.
- Workspace: one worktree per concurrent implementer, each agent committing its
  own task there. Tasks 1 to 3 have disjoint Touches and no Needs between them,
  so all three can overlap; Task 4 is the flip and runs alone once they land.
MD

cat > .sluice/run.json <<'JSON'
{
  "schema": 1,
  "topic": "step-timings",
  "channel": "deep",
  "started": "2026-09-23T04:31:45Z",
  "plan": "docs/plans/2026-09-22-step-timings.md",
  "record": "docs/plans/2026-09-22-step-timings-record.md",
  "tasks": [
    {
      "id": 1,
      "status": "todo",
      "name": "duration formatter",
      "tier": 2,
      "offers": [
        "formatDuration",
        "ms",
        "number",
        "string"
      ],
      "touches": [
        "src/cli/duration.js",
        "tests/duration.test.js"
      ]
    },
    {
      "id": 2,
      "status": "todo",
      "name": "timings flag parsing",
      "tier": 1,
      "offers": [
        "argv",
        "boolean",
        "dryRun",
        "parseArgs",
        "string",
        "timings"
      ],
      "touches": [
        "src/cli/args.js",
        "tests/args.test.js"
      ]
    },
    {
      "id": 3,
      "status": "todo",
      "name": "stopwatch",
      "tier": 2,
      "offers": [
        "createStopwatch",
        "lap",
        "now",
        "number"
      ],
      "touches": [
        "src/cli/stopwatch.js",
        "tests/stopwatch.test.js"
      ]
    },
    {
      "id": 4,
      "status": "todo",
      "name": "turn timings on",
      "tier": 3,
      "flips": true,
      "needs": [
        "createStopwatch",
        "formatDuration",
        "lap",
        "parseArgs"
      ],
      "offers": [
        "args",
        "boolean",
        "deploy",
        "dryRun",
        "now",
        "number",
        "timings",
        "void"
      ],
      "touches": [
        "src/cli/deploy.js",
        "tests/deploy.test.js"
      ]
    }
  ],
  "updated": "2026-09-23T04:31:46Z",
  "preflight": {
    "review": "tier 3 only",
    "effort": "0 of 4 low",
    "workspace": "one worktree per concurrent implementer, agents commit"
  }
}
JSON

git init --quiet
git add -A
git -c user.email=fixture@example.com -c user.name=fixture commit --quiet -m "docs(plans): add the step-timings plan and record"
