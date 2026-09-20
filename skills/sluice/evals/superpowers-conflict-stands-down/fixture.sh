#!/usr/bin/env bash
# A repo whose own instructions mandate the superpowers sequence. The plugin is
# not installed: the test is whether the mandate alone stands the router down.
set -euo pipefail

mkdir -p src/cli .superpowers/sdd

cat > CLAUDE.md <<'MD'
# Working agreement

This repo runs spec-driven development. Every change that adds to or alters what
the software does goes through the full sequence, in order, with no steps skipped
and no step started before the one before it is signed off:

1. **Brainstorm** the problem with me until we agree what we are solving.
2. **Write the spec** to `.superpowers/sdd/<date>-<topic>/spec.md` and get it approved.
3. **Write the plan** to `.superpowers/sdd/<date>-<topic>/plan.md` and get it approved.
4. **Break the plan into task briefs**, one file per task.
5. **Implement** one task at a time, each with its own report.
6. **Review** the diff before anything merges.

This sequence is not optional and does not scale down for small changes. Do not
substitute another process for it.
MD

cat > src/cli/deploy.js <<'JS'
const STEPS = ["build", "upload", "activate"];

export function deploy(args, log = console.log) {
  for (const step of STEPS) {
    log(`-> ${step}`);
  }
  log("deployed: 3 steps");
}
JS

git init --quiet
git add -A
git -c user.email=fixture@example.com -c user.name=fixture commit --quiet -m "initial"
