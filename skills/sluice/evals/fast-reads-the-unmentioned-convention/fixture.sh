#!/usr/bin/env bash
# A deploy command whose flags live in one table: src/cli/flags.js holds FLAGS,
# and --help is generated from it. CONTRIBUTING.md says so and the prompt does
# not, so a run that only reads deploy.js will parse --verbose inline and leave
# the table and the help text behind. The help test pins the whole output, so
# registering the flag means updating it.
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

cat > src/cli/flags.js <<'JS'
export const FLAGS = [
  { name: "--dry-run", description: "list the steps without running them" },
  { name: "--help", description: "print this help and exit" },
];

export function parseFlags(args) {
  const known = new Set(FLAGS.map((flag) => flag.name));
  for (const arg of args) {
    if (!known.has(arg)) {
      throw new Error(`unknown flag: ${arg}`);
    }
  }
  return new Set(args);
}

export function helpText() {
  const width = Math.max(...FLAGS.map((flag) => flag.name.length));
  return [
    "usage: shipit deploy [flags]",
    "",
    ...FLAGS.map((flag) => `  ${flag.name.padEnd(width)}  ${flag.description}`),
  ].join("\n");
}
JS

cat > src/cli/deploy.js <<'JS'
import { helpText, parseFlags } from "./flags.js";

const STEPS = ["build", "upload", "activate"];

export function deploy(args, log = console.log) {
  const flags = parseFlags(args);

  if (flags.has("--help")) {
    log(helpText());
    return;
  }

  const dryRun = flags.has("--dry-run");

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

test("an unregistered flag is refused", () => {
  assert.throws(() => deploy(["--loud"], () => {}), /unknown flag: --loud/);
});
JS

cat > tests/help.test.js <<'JS'
import assert from "node:assert/strict";
import { test } from "node:test";
import { deploy } from "../src/cli/deploy.js";

test("--help lists every registered flag", () => {
  const lines = [];
  deploy(["--help"], (line) => lines.push(line));
  assert.equal(
    lines.join("\n"),
    [
      "usage: shipit deploy [flags]",
      "",
      "  --dry-run  list the steps without running them",
      "  --help     print this help and exit",
    ].join("\n"),
  );
});
JS

cat > CONTRIBUTING.md <<'MD'
# Contributing to shipit

Run `npm test` before you push. Every behaviour change comes with a test.

## Flags

Every flag is registered in the `FLAGS` table in `src/cli/flags.js`, with a
one-line description. `parseFlags` refuses anything not in the table, and
`--help` is generated from it, so a flag that is not registered is neither
accepted nor documented. Adding a flag means adding its row and updating
`tests/help.test.js` to match.
MD

cat > README.md <<'MD'
# shipit

Deploy CLI. `npm test` runs the suite. See CONTRIBUTING.md before changing it.
MD

git init --quiet
git add -A
git -c user.email=fixture@example.com -c user.name=fixture commit --quiet -m "shipit 1.2.0"
