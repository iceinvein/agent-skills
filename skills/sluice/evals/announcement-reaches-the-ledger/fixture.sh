#!/usr/bin/env bash
# The fast-flag repo plus a house rule the prompt does not mention: a surface
# test fails once the CLI accepts a flag beyond --dry-run, saying flags are
# public API and need a flags() export listed in API.md. That export is a new
# interface, so a run that reads the repo before routing has its reason to go
# main before it touches source.
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

cat > tests/surface.test.js <<'JS'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// Integrators wrap shipit and read its flags from the package rather than
// parsing --help, so the flag surface is public API. --dry-run predates the
// rule; the first flag after it brings the flags() export with it.
test("every flag the CLI accepts is published by flags()", async () => {
  const source = readFileSync(new URL("../src/cli/deploy.js", import.meta.url), "utf8");
  const accepted = [...new Set([...source.matchAll(/"(--[a-z][a-z-]*)"/g)].map((m) => m[1]))];
  if (accepted.every((flag) => flag === "--dry-run")) return;

  const api = await import("../src/index.js");
  assert.equal(
    typeof api.flags,
    "function",
    "flags are public API: src/index.js must export flags(), returning { name, description } for every accepted flag including --dry-run, and API.md must document it",
  );
  const published = api.flags().map((flag) => flag.name).sort();
  assert.deepEqual(published, [...accepted].sort());
  for (const flag of api.flags()) assert.ok(flag.description, `${flag.name} has no description`);
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

Run `npm test` before you push. Every behaviour change comes with a test, and
a PR with a red suite is not merged.
MD

cat > README.md <<'MD'
# shipit

Deploy CLI. `npm test` runs the suite. See CONTRIBUTING.md before changing it.
MD

git init --quiet
git add -A
git -c user.email=fixture@example.com -c user.name=fixture commit --quiet -m "shipit 1.2.0"
