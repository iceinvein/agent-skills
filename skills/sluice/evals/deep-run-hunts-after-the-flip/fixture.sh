#!/usr/bin/env bash
# A deep run with every task done, the flip included, and nothing left but the
# hunt, the final review and the finish. The spec states a checkable limit (a
# step runs at most four times) and the flip's commit breaks it by one: its
# loop gives up after three attempts. The suite only covers a step that
# succeeds by its third attempt and a step that never does, so it is green,
# and the bug is there for the hunt over <base>..HEAD to prove.
set -euo pipefail

mkdir -p src/cli tests docs/specs docs/plans .sluice
printf '*\n' > .sluice/.gitignore
git init --quiet

commit() {
  git add -A
  git -c user.email=fixture@example.com -c user.name=fixture commit --quiet -m "$1"
}

cat > package.json <<'JSON'
{
  "name": "shipit",
  "version": "1.3.0",
  "type": "module",
  "scripts": {
    "test": "node --test \"tests/*.test.js\""
  }
}
JSON

cat > src/cli/deploy.js <<'JS'
const STEPS = ["build", "upload", "activate"];

export function deploy(runStep, log = console.log) {
  for (const step of STEPS) {
    log(`-> ${step}`);
    runStep(step);
  }
  log("deployed: 3 steps");
}
JS

cat > tests/deploy.test.js <<'JS'
import assert from "node:assert/strict";
import { test } from "node:test";
import { deploy } from "../src/cli/deploy.js";

test("a full deploy reports every step", () => {
  const lines = [];
  deploy(() => {}, (line) => lines.push(line));
  assert.deepEqual(lines, ["-> build", "-> upload", "-> activate", "deployed: 3 steps"]);
});
JS

cat > docs/specs/2026-10-01-step-retries.md <<'MD'
# Design: step retries

## Context

A deploy step that fails once on a flaky network ends the whole deploy today.

## Decisions

- **D1 The limit.** A failed step is retried up to three times, so it runs at
  most four times in all. `MAX_ATTEMPTS` in `src/cli/retry-policy.js` is 4,
  and it is the only place the number lives.
- **D2 Giving up.** When the fourth attempt fails, the deploy stops with
  `step <name> failed after 4 attempts` and runs no later step.
- **D3 Success.** A step that succeeds on any attempt up to the fourth lets
  the deploy carry on to the next step, and the progress lines are unchanged.
MD

cat > docs/plans/2026-10-01-step-retries.md <<'MD'
# Plan: step-retries

## Goal

A failed deploy step is retried up to three times (four attempts in all), as
`docs/specs/2026-10-01-step-retries.md` states.

## Architecture

The limit lives in one module, `src/cli/retry-policy.js`. `deploy` reads it and
wraps each step in the retry loop; nothing else changes.

## Ground Rules

- Commit message convention: `<type>(<scope>): <subject>`, subject lower case,
  no trailing full stop, no attribution trailers and no tool footers.
- Test runner: `npm test`, which runs `node --test "tests/*.test.js"`.
- Node built-ins only. No dependency may be added to package.json.

### Task 1: retry policy

**Contract:** Needs: none | Offers: `MAX_ATTEMPTS: number`
**Touches:** src/cli/retry-policy.js (new) | tests/retry-policy.test.js (new)

- [x] Add a test asserting `MAX_ATTEMPTS` is 4 -> it fails because src/cli/retry-policy.js does not exist
- [x] Export `MAX_ATTEMPTS = 4` -> `npm test` green

### Task 2: retry each step

**Contract:** Needs: `MAX_ATTEMPTS: number` | Offers: `deploy(runStep: (step: string) => void, log?: (line: string) => void) -> void`
**Touches:** src/cli/deploy.js (edit) | tests/deploy.test.js (test)
**Flips:** a failed step is retried instead of ending the deploy

- [x] Add a test where `runStep` fails twice on `upload` and then succeeds, asserting the deploy finishes -> it fails because deploy does not retry
- [x] Add a test where `runStep` always fails on `upload`, asserting the deploy throws and never reaches `activate` -> it fails for the same reason
- [x] Wrap each step in a loop bounded by `MAX_ATTEMPTS` -> `npm test` green
MD

commit "chore: shipit 1.3.0 with the step-retries design and plan"
BASE="$(git rev-parse HEAD)"

cat > src/cli/retry-policy.js <<'JS'
export const MAX_ATTEMPTS = 4;
JS

cat > tests/retry-policy.test.js <<'JS'
import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_ATTEMPTS } from "../src/cli/retry-policy.js";

test("a step runs at most four times", () => {
  assert.equal(MAX_ATTEMPTS, 4);
});
JS

commit "feat(retry): add the retry policy"
TASK1="$(git rev-parse HEAD)"

cat > src/cli/deploy.js <<'JS'
import { MAX_ATTEMPTS } from "./retry-policy.js";

const STEPS = ["build", "upload", "activate"];

export function deploy(runStep, log = console.log) {
  for (const step of STEPS) {
    log(`-> ${step}`);
    let attempt = 1;
    while (true) {
      try {
        runStep(step);
        break;
      } catch {
        if (attempt >= MAX_ATTEMPTS - 1) {
          throw new Error(`step ${step} failed after ${attempt} attempts`);
        }
        attempt++;
      }
    }
  }
  log("deployed: 3 steps");
}
JS

cat > tests/deploy.test.js <<'JS'
import assert from "node:assert/strict";
import { test } from "node:test";
import { deploy } from "../src/cli/deploy.js";

function failing(step, times) {
  let failures = 0;
  const ran = [];
  return {
    ran,
    runStep(name) {
      ran.push(name);
      if (name === step && failures < times) {
        failures++;
        throw new Error(`${name} is down`);
      }
    },
  };
}

test("a full deploy reports every step", () => {
  const lines = [];
  deploy(() => {}, (line) => lines.push(line));
  assert.deepEqual(lines, ["-> build", "-> upload", "-> activate", "deployed: 3 steps"]);
});

test("a step that fails twice and then succeeds lets the deploy finish", () => {
  const lines = [];
  const upload = failing("upload", 2);
  deploy(upload.runStep, (line) => lines.push(line));
  assert.equal(lines.at(-1), "deployed: 3 steps");
});

test("a step that never succeeds stops the deploy before the next step", () => {
  const upload = failing("upload", Infinity);
  assert.throws(() => deploy(upload.runStep, () => {}), /failed/);
  assert.equal(upload.ran.includes("activate"), false);
});
JS

commit "feat(deploy): retry a failed step"
TASK2="$(git rev-parse HEAD)"

cat > docs/plans/2026-10-01-step-retries-record.md <<MD
# Run record: step-retries

## Pre-flight

- Review: tier 3 only. Task 2 is the flip and is the one task that got a reviewer.
- Effort: this session's effort for both tasks.
- Workspace: shared tree. Tasks ran serially, so no worktree was cut.
- Base: \`${BASE}\`, the commit the plan landed on.

## Log

- Task 1, retry policy: landed at \`${TASK1}\`. Inert, nothing reads it yet.
- Task 2, retry each step: landed at \`${TASK2}\`, the flip. Reviewed, no
  findings.
MD

commit "docs(plans): step-retries run record"

cat > .sluice/run.json <<JSON
{
  "schema": 1,
  "topic": "step-retries",
  "channel": "deep",
  "started": "2026-10-01T09:02:11Z",
  "plan": "docs/plans/2026-10-01-step-retries.md",
  "record": "docs/plans/2026-10-01-step-retries-record.md",
  "tasks": [
    {
      "id": 1,
      "status": "done",
      "name": "retry policy",
      "tier": 2,
      "base": "${BASE}",
      "commit": "${TASK1}",
      "offers": ["MAX_ATTEMPTS", "number"],
      "touches": ["src/cli/retry-policy.js", "tests/retry-policy.test.js"]
    },
    {
      "id": 2,
      "status": "done",
      "name": "retry each step",
      "tier": 3,
      "flips": true,
      "reviewed": true,
      "base": "${TASK1}",
      "commit": "${TASK2}",
      "needs": ["MAX_ATTEMPTS", "number"],
      "offers": ["deploy", "line", "log", "runStep", "step", "string", "void"],
      "touches": ["src/cli/deploy.js", "tests/deploy.test.js"]
    }
  ],
  "updated": "2026-10-01T10:41:53Z",
  "preflight": {
    "review": "tier3",
    "effort": "0 of 2 low",
    "workspace": "shared"
  }
}
JSON
