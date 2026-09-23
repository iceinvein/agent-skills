#!/usr/bin/env bash
# The fast-flag repo plus a house rule the prompt does not mention: flags are
# public API, and the first new flag has to create the flags() export that
# API.md lists. That export is a new interface, so a run that starts fast and
# reads CONTRIBUTING.md has a real reason to re-route to main mid-turn.
set -euo pipefail

mkdir -p src/cli tests

cat > package.json <<'JSON'
{
  "name": "shipit",
  "version": "1.2.0",
  "type": "module",
  "main": "src/index.js",
  "scripts": {
    "test": "node --test \"tests/*.test.js\""
  }
}
JSON

cat > src/index.js <<'JS'
export { deploy } from "./cli/deploy.js";
JS

cat > src/cli/deploy.js <<'JS'
const STEPS = ["build", "upload", "activate"];

export function deploy(args, log = console.log) {
  const dryRun = args.includes("--dry-run");

  for (const step of STEPS) {
    log(`-> ${step}`);
    if (!dryRun) {
      run(step);
    }
  }

  log(dryRun ? "dry run: 3 steps skipped" : "deployed: 3 steps");
}

function run(step) {
  if (!STEPS.includes(step)) {
    throw new Error(`unknown step: ${step}`);
  }
}
JS

cat > tests/deploy.test.js <<'JS'
import assert from "node:assert/strict";
import { test } from "node:test";
import { deploy } from "../src/cli/deploy.js";

function capture() {
  const lines = [];
  return { lines, log: (line) => lines.push(line) };
}

test("dry run skips the steps and says so", () => {
  const { lines, log } = capture();
  deploy(["--dry-run"], log);
  assert.equal(lines.at(-1), "dry run: 3 steps skipped");
});

test("a full deploy reports every step", () => {
  const { lines, log } = capture();
  deploy([], log);
  assert.deepEqual(lines, ["-> build", "-> upload", "-> activate", "deployed: 3 steps"]);
});
JS

cat > API.md <<'MD'
# shipit public API

Everything exported from `src/index.js`. Integrators import from the package
root, so anything listed here is covered by semver.

## `deploy(args, log = console.log)`

Runs build, upload and activate in order. `args` is the argv slice after the
command name. `log` receives one line per step and a final summary line.
MD

cat > CONTRIBUTING.md <<'MD'
# Contributing to shipit

Run `npm test` before you push. Every behaviour change comes with a test.

## Flags are public API

Integrators build their own wrappers around shipit and need to know which flags
the installed version accepts without parsing `--help`. So, starting with the
next flag we add:

- every flag the CLI accepts is returned by a `flags()` function exported from
  `src/index.js`, as `{ name, description }` objects;
- `flags()` is documented in `API.md`, like every other export;
- `--dry-run` predates this rule and goes into `flags()` alongside the first new
  flag.

A PR that adds a flag without both is not merged.
MD

cat > README.md <<'MD'
# shipit

Deploy CLI. `npm test` runs the suite. See CONTRIBUTING.md before changing it.
MD

git init --quiet
git add -A
git -c user.email=fixture@example.com -c user.name=fixture commit --quiet -m "shipit 1.2.0"
