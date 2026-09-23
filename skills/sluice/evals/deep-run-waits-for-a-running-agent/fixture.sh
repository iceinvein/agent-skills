#!/usr/bin/env bash
# The deep run from deep-run-finishes-every-task, with one pre-flight answer
# added: every task goes to its own implementer agent. A dispatched agent can
# still be running when the controller has nothing else to do, and "T2 is
# running, I will report when it finishes" reads like a handback while three
# tasks are still open. The controller waits for the result, flips the row and
# dispatches the next one; the turn ends only after the last task reports.
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

# Task 1, already landed: the sink exists and nothing routes through it yet.
cat > src/cli/progress.js <<'JS'
export function createSink({ quiet }) {
  return {
    write(line) {
      if (!quiet) {
        console.log(line);
      }
    },
  };
}
JS

cat > tests/progress.test.js <<'JS'
import assert from "node:assert/strict";
import { test } from "node:test";
import { createSink } from "../src/cli/progress.js";

test("a loud sink prints the line", () => {
  const lines = [];
  const sink = createSink({ quiet: false });
  const restore = console.log;
  console.log = (line) => lines.push(line);
  try {
    sink.write("-> build");
  } finally {
    console.log = restore;
  }
  assert.deepEqual(lines, ["-> build"]);
});

test("a quiet sink swallows the line", () => {
  const lines = [];
  const sink = createSink({ quiet: true });
  const restore = console.log;
  console.log = (line) => lines.push(line);
  try {
    sink.write("-> build");
  } finally {
    console.log = restore;
  }
  assert.deepEqual(lines, []);
});
JS

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

cat > docs/plans/2026-09-20-quiet-flag.md <<'MD'
# Plan: quiet-flag

## Goal

`deploy --quiet` suppresses the three per-step progress lines and leaves the
final summary line untouched. Every other deploy output is unchanged.

## Architecture

Progress lines go through a sink instead of `console.log`. The sink is built
from the parsed flags and handed to `deploy`, so `deploy` never asks whether it
is quiet. The summary line does not go through the sink.

## Ground Rules

- Commit message convention: `<type>(<scope>): <subject>`, subject lower case,
  no trailing full stop, no attribution trailers and no tool footers.
- Test runner: `npm test`, which runs `node --test "tests/*.test.js"`.
- Node built-ins only. No dependency may be added to package.json.
- Every test asserts on captured output lines, never on internal state.

### Task 1: progress sink

**Contract:** Needs: none | Offers: `createSink({ quiet: boolean }) -> { write(line: string): void }`
**Touches:** src/cli/progress.js (new) | tests/progress.test.js (new)

- [x] Add a test asserting a sink built with `quiet: false` prints the line it is given -> the test fails because src/cli/progress.js does not exist
- [x] Add a test asserting a sink built with `quiet: true` prints nothing -> it fails for the same reason
- [x] Write `createSink` returning an object with a `write` method that prints unless `quiet` -> `npm test` green

### Task 2: quiet flag parsing

**Contract:** Needs: none | Offers: `parseArgs(argv: string[]) -> { dryRun: boolean, quiet: boolean }`
**Touches:** src/cli/args.js (edit) | tests/args.test.js (test)

- [ ] Add a test asserting `parseArgs(["--quiet"])` returns `{ dryRun: false, quiet: true }` -> the new test fails, the existing dry-run test still passes
- [ ] Add a test asserting `parseArgs([])` returns `{ dryRun: false, quiet: false }` -> it fails on the missing key
- [ ] Read `--quiet` off argv alongside `--dry-run` -> `npm test` green

### Task 3: route progress through the sink

**Contract:** Needs: `createSink({ quiet: boolean }) -> { write(line: string): void }` | Offers: `deploy(args: { dryRun: boolean }, sink: { write(line: string): void }) -> void`
**Touches:** src/cli/deploy.js (edit) | tests/deploy.test.js (test)

- [ ] Add a test passing a recording sink to `deploy` and asserting the three `-> <step>` lines arrive on the sink -> the new test fails because deploy takes no sink
- [ ] Give `deploy` a second parameter `sink` and send each `-> <step>` line to `sink.write` -> the new test passes
- [ ] Keep the summary line on `console.log` and keep both original deploy tests asserting the exact lines `dry run: 3 steps skipped` and `deployed: 3 steps` -> `npm test` green

### Task 4: turn quiet on

**Contract:** Needs: `parseArgs(argv: string[]) -> { dryRun: boolean, quiet: boolean }`, `createSink({ quiet: boolean }) -> { write(line: string): void }`, `deploy(args: { dryRun: boolean }, sink: { write(line: string): void }) -> void` | Offers: `main(argv: string[]) -> void`
**Touches:** src/cli/main.js (new) | tests/main.test.js (test)
**Flips:** the three progress lines become suppressible; before this task `--quiet` parses and changes nothing

- [ ] Add a test asserting `main(["--quiet"])` prints only `deployed: 3 steps` -> it fails because src/cli/main.js does not exist
- [ ] Add a test asserting `main([])` prints the three step lines and then `deployed: 3 steps` -> it fails for the same reason
- [ ] Write `main` to call `parseArgs`, build the sink from `quiet`, and call `deploy` with both -> `npm test` green
MD

cat > docs/plans/2026-09-20-quiet-flag-record.md <<'MD'
# Run record: quiet-flag

## Pre-flight

- Review: tier 3 only. Task 4 is the flip and is the one task that gets a reviewer.
- Effort: this session's effort for every task. None of the three remaining tasks was marked mechanical.
- Workspace: shared tree. Tasks run serially, so no worktree was cut.
- Dispatch: every task goes to its own implementer agent, one at a time in the
  shared tree, and each agent commits its own task. The controller writes the
  run state and does not implement.

## Log

- Task 1, progress sink: landed. `createSink` written with both tests green.
  Inert by design, nothing routes through it yet.
MD

cat > .sluice/run.json <<'JSON'
{
  "schema": 1,
  "topic": "quiet-flag",
  "channel": "deep",
  "started": "2026-09-23T04:31:42Z",
  "plan": "docs/plans/2026-09-20-quiet-flag.md",
  "record": "docs/plans/2026-09-20-quiet-flag-record.md",
  "tasks": [
    {
      "id": 1,
      "status": "done",
      "name": "progress sink",
      "tier": 2,
      "offers": [
        "boolean",
        "createSink",
        "line",
        "quiet",
        "string",
        "void",
        "write"
      ],
      "touches": [
        "src/cli/progress.js",
        "tests/progress.test.js"
      ]
    },
    {
      "id": 2,
      "status": "todo",
      "name": "quiet flag parsing",
      "tier": 1,
      "offers": [
        "argv",
        "boolean",
        "dryRun",
        "parseArgs",
        "quiet",
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
      "name": "route progress through the sink",
      "tier": 1,
      "needs": [
        "createSink",
        "write"
      ],
      "offers": [
        "args",
        "boolean",
        "deploy",
        "dryRun",
        "line",
        "sink",
        "string",
        "void",
        "write"
      ],
      "touches": [
        "src/cli/deploy.js",
        "tests/deploy.test.js"
      ]
    },
    {
      "id": 4,
      "status": "todo",
      "name": "turn quiet on",
      "tier": 3,
      "flips": true,
      "needs": [
        "createSink",
        "deploy",
        "parseArgs",
        "write"
      ],
      "offers": [
        "argv",
        "main",
        "string",
        "void"
      ],
      "touches": [
        "src/cli/main.js",
        "tests/main.test.js"
      ]
    }
  ],
  "updated": "2026-09-23T04:31:42Z",
  "preflight": {
    "review": "tier 3 only",
    "effort": "0 of 3 low",
    "workspace": "shared tree, serial; every task dispatched to its own implementer agent, agents commit"
  }
}
JSON

git init --quiet
git add -A
git -c user.email=fixture@example.com -c user.name=fixture commit --quiet -m "feat(progress): add the quiet-aware progress sink"
