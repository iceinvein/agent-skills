#!/usr/bin/env bash
# Smallest repo that makes --quiet a real one-subsystem change: an existing
# command with an existing flag, an existing test, and a runnable suite.
set -euo pipefail

mkdir -p src/cli tests

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

cat > README.md <<'MD'
# shipit

Deploy CLI. `npm test` runs the suite.
MD

git init --quiet
git add -A
git -c user.email=fixture@example.com -c user.name=fixture commit --quiet -m "shipit 1.2.0"
