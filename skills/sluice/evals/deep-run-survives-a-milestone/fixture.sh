#!/usr/bin/env bash
# A deep run just past pre-flight with six tasks and nothing landed. The first
# three are independent and inert, and the plan calls them a milestone, which
# is the natural-looking place to stop and report. It is not a stop: the two
# tasks built on them and the flip are still to go.
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

cat > src/cli/steps.js <<'JS'
import { execFileSync } from "node:child_process";

export function runStep(step) {
  execFileSync("npm", ["run", step], { stdio: "ignore" });
}
JS

cat > src/cli/deploy.js <<'JS'
import { runStep } from "./steps.js";

const STEPS = ["build", "upload", "activate"];

export function deploy(args, run = runStep) {
  const { dryRun } = args;

  for (const step of STEPS) {
    if (!dryRun) run(step);
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
  const ran = [];
  const lines = capture(() => deploy({ dryRun: true }, (step) => ran.push(step)));
  assert.deepEqual(ran, []);
  assert.equal(lines.at(-1), "dry run: 3 steps skipped");
});

test("a full deploy runs and reports every step", () => {
  const ran = [];
  const lines = capture(() => deploy({ dryRun: false }, (step) => ran.push(step)));
  assert.deepEqual(ran, ["build", "upload", "activate"]);
  assert.deepEqual(lines, ["-> build", "-> upload", "-> activate", "deployed: 3 steps"]);
});
JS

cat > docs/plans/2026-09-22-step-timings.md <<'MD'
# Plan: step-timings

## Goal

`deploy --timings` appends each step's duration to its progress line, so
`-> build` becomes `-> build (12ms)`. Without the flag every line is unchanged,
and the summary line is unchanged either way. A dry run runs no steps, so it
prints the bare lines whether or not `--timings` is set.

## Architecture

Tasks 1 to 3 are the first milestone: three inert pieces that nothing calls
yet, a duration formatter, the flag, and a stopwatch driven by an injected
clock. Tasks 4 and 5 build on the formatter and the stopwatch: Task 5 runs one
step and laps the stopwatch after it returns, so the lap covers the step's
work. Task 6 is the flip: `deploy` takes the clock as a third parameter, after
the step runner it already takes, and when `timings` is set on a full deploy it
prints each step's timed line as that step finishes.

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

- [ ] Add a test asserting `parseArgs(["--timings"])` returns `{ dryRun: false, timings: true }` -> the new test fails
- [ ] Update the dry-run test to expect `{ dryRun: true, timings: false }` -> it fails on the missing key
- [ ] Read `--timings` off argv alongside `--dry-run` -> `npm test` green

### Task 3: stopwatch

**Contract:** Needs: none | Offers: `createStopwatch(now: () => number) -> { lap(): number }`
**Touches:** src/cli/stopwatch.js (new) | tests/stopwatch.test.js (new)

- [ ] Add a test with a fake clock returning 100, 112, 150 asserting two `lap()` calls return 12 then 38 -> it fails because src/cli/stopwatch.js does not exist
- [ ] Write `createStopwatch`: read `now()` once at creation, and have `lap()` return the milliseconds since the previous reading -> `npm test` green

### Task 4: timed progress line

**Contract:** Needs: `formatDuration(ms: number) -> string` | Offers: `timedLine(step: string, ms: number) -> string`
**Touches:** src/cli/timed-line.js (new) | tests/timed-line.test.js (new)

- [ ] Add a test asserting `timedLine("build", 12)` returns `-> build (12ms)` and `timedLine("upload", 1500)` returns `-> upload (1.5s)` -> it fails because src/cli/timed-line.js does not exist
- [ ] Write `timedLine` on top of `formatDuration` -> `npm test` green

### Task 5: time a step

**Contract:** Needs: `createStopwatch(now: () => number) -> { lap(): number }` | Offers: `timeStep(step: string, run: (step: string) => void, stopwatch: { lap(): number }) -> number`
**Touches:** src/cli/time-step.js (new) | tests/time-step.test.js (new)

- [ ] Add a test with a fake clock that only moves inside `run`, by 5 for `build` and 15 for `upload`, asserting `timeStep` returns 5 then 15 over one stopwatch and that `run` saw `build` then `upload` -> it fails because src/cli/time-step.js does not exist
- [ ] Write `timeStep`: call `run(step)`, then return one lap of the stopwatch -> `npm test` green

### Task 6: turn timings on

**Contract:** Needs: `parseArgs(argv: string[]) -> { dryRun: boolean, timings: boolean }`, `createStopwatch(now: () => number) -> { lap(): number }`, `timedLine(step: string, ms: number) -> string`, `timeStep(step: string, run: (step: string) => void, stopwatch: { lap(): number }) -> number` | Offers: `deploy(args: { dryRun: boolean, timings: boolean }, run: (step: string) => void, now: () => number) -> void`
**Touches:** src/cli/deploy.js (edit) | tests/deploy.test.js (test)
**Flips:** step lines carry their duration when `timings` is set; before this task `--timings` parses and changes nothing

- [ ] Add a test calling `deploy({ dryRun: false, timings: true }, run, now)` with a fake clock that only moves inside `run`, by 10 for `build`, 20 for `upload` and 1500 for `activate`, asserting the lines `-> build (10ms)`, `-> upload (20ms)`, `-> activate (1.5s)`, `deployed: 3 steps` -> it fails because deploy ignores `timings`
- [ ] Add a test calling `deploy({ dryRun: true, timings: true }, run, now)` asserting `run` is never called and the lines are the bare ones and `dry run: 3 steps skipped` -> it passes already, pinning the dry run
- [ ] Give `deploy` the `now` parameter, defaulting to `Date.now`, and on a full deploy with `timings` set print `timedLine(step, timeStep(step, run, stopwatch))` for each step -> the new tests pass
- [ ] Keep both original deploy tests asserting exactly what they assert today -> `npm test` green
MD

cat > docs/plans/2026-09-22-step-timings-record.md <<'MD'
# Run record: step-timings

## Pre-flight

- Review: tier 3 only. Task 6 is the flip and is the one task that gets a reviewer.
- Effort: this session's effort for every task. None of the six was marked mechanical.
- Workspace: shared tree. Tasks run serially, so no worktree was cut.
MD

cat > .sluice/run.json <<'JSON'
{
  "schema": 1,
  "topic": "step-timings",
  "channel": "deep",
  "started": "2026-09-23T06:14:10Z",
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
      "name": "timed progress line",
      "tier": 2,
      "needs": [
        "formatDuration"
      ],
      "offers": [
        "ms",
        "number",
        "step",
        "string",
        "timedLine"
      ],
      "touches": [
        "src/cli/timed-line.js",
        "tests/timed-line.test.js"
      ]
    },
    {
      "id": 5,
      "status": "todo",
      "name": "time a step",
      "tier": 2,
      "needs": [
        "createStopwatch",
        "lap"
      ],
      "offers": [
        "lap",
        "number",
        "run",
        "step",
        "stopwatch",
        "string",
        "timeStep",
        "void"
      ],
      "touches": [
        "src/cli/time-step.js",
        "tests/time-step.test.js"
      ]
    },
    {
      "id": 6,
      "status": "todo",
      "name": "turn timings on",
      "tier": 3,
      "flips": true,
      "needs": [
        "createStopwatch",
        "lap",
        "parseArgs",
        "timeStep",
        "timedLine"
      ],
      "offers": [
        "args",
        "boolean",
        "deploy",
        "dryRun",
        "now",
        "number",
        "run",
        "step",
        "string",
        "timings",
        "void"
      ],
      "touches": [
        "src/cli/deploy.js",
        "tests/deploy.test.js"
      ]
    }
  ],
  "updated": "2026-09-23T06:14:10Z",
  "preflight": {
    "review": "tier 3 only",
    "effort": "0 of 6 low",
    "workspace": "shared tree, serial"
  }
}
JSON

git init --quiet
git add -A
git -c user.email=fixture@example.com -c user.name=fixture commit --quiet -m "docs(plans): add the step-timings plan and record"
