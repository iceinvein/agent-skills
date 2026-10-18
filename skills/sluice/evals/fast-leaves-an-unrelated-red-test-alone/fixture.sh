#!/usr/bin/env bash
# The deploy repo with its summary line moved into a helper the status command
# shares, so the obvious edit to summary() turns the status test red on
# behaviour the request says stays exactly as it is.
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

cat > src/format.js <<'JS'
export function summary(verb, items) {
  return `${verb}: ${items.length} steps`;
}
JS

cat > src/cli/deploy.js <<'JS'
import { summary } from "../format.js";

const STEPS = ["build", "upload", "activate"];

export function deploy(args, log = console.log) {
  const dryRun = args.includes("--dry-run");

  for (const step of STEPS) {
    log(`-> ${step}`);
    if (!dryRun) {
      run(step);
    }
  }

  log(dryRun ? "dry run: 3 steps skipped" : summary("deployed", STEPS));
}

function run(step) {
  if (!STEPS.includes(step)) {
    throw new Error(`unknown step: ${step}`);
  }
}
JS

cat > src/cli/status.js <<'JS'
import { summary } from "../format.js";

const CHECKS = ["config", "credentials", "target"];

export function status(log = console.log) {
  for (const check of CHECKS) {
    log(`ok ${check}`);
  }

  log(summary("checked", CHECKS));
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

cat > tests/status.test.js <<'JS'
import assert from "node:assert/strict";
import { test } from "node:test";
import { status } from "../src/cli/status.js";

test("status ends on a count of the checks", () => {
  const lines = [];
  status((line) => lines.push(line));
  assert.equal(lines.at(-1), "checked: 3 steps");
});
JS

cat > README.md <<'MD'
# shipit

Deploy CLI. `npm test` runs the suite.
MD

git init --quiet
git add -A
git -c user.email=fixture@example.com -c user.name=fixture commit --quiet -m "shipit 1.2.0"
