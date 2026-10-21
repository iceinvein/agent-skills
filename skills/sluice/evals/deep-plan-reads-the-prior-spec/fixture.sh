#!/usr/bin/env bash
# A sign-in service where an earlier spec already settled where counters live:
# `data/counters.json`, never only in memory, because a restart must not reset
# a count. The three subsystems run in one process, so a Map in the sign-in
# handler is the obvious design and nothing in the code forbids it. Only the
# earlier spec does, and the prompt never names it, so the case pins whether
# the run reads the repo's prior specs before it designs. The README fixes
# where the design goes, so the graders can read it.
set -euo pipefail

mkdir -p src/api src/worker src/report data tests docs/specs

cat > package.json <<'JSON'
{
  "name": "gate",
  "version": "1.3.0",
  "type": "module",
  "scripts": {
    "test": "node --test \"tests/*.test.js\""
  }
}
JSON

cat > src/api/sign-in.js <<'JS'
import { verify } from "./passwords.js";

export async function signIn(accounts, name, password) {
  const account = accounts.find((candidate) => candidate.name === name);
  if (account === undefined || !(await verify(password, account.hash))) {
    return { status: 401 };
  }
  return { status: 200, account: account.name };
}
JS

cat > src/api/passwords.js <<'JS'
import { scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const derive = promisify(scrypt);

export async function verify(password, hash) {
  const [salt, key] = hash.split(":");
  const derived = await derive(password, salt, 32);
  return timingSafeEqual(derived, Buffer.from(key, "hex"));
}
JS

cat > src/report/exports.js <<'JS'
import { readFileSync, writeFileSync } from "node:fs";

const counters = new URL("../../data/counters.json", import.meta.url);

export function recordExport() {
  const current = JSON.parse(readFileSync(counters, "utf8"));
  current.exports = (current.exports ?? 0) + 1;
  writeFileSync(counters, JSON.stringify(current, null, 2) + "\n");
  return current.exports;
}
JS

cat > src/worker/nightly.js <<'JS'
// The scheduler calls this once a night with that night's jobs.
export async function nightly(jobs) {
  for (const job of jobs) {
    await job();
  }
  return jobs.length;
}
JS

cat > data/counters.json <<'JSON'
{
  "exports": 12
}
JSON

cat > docs/specs/2026-09-01-counters.md <<'MD'
# Design: counters

## Context

The export count was a module variable in `src/report/exports.js`, and every
deploy restarted the process and reset it to zero. Finance reads the count.

### D1. Counters persist in data/counters.json

Every counter the service keeps, today's and any later one, persists in
`data/counters.json`, one top-level key per counter, read and written whole.
A counter is never held only in memory, because the process restarts on every
deploy and a count that resets on deploy is wrong. A cache in front of the file
is fine; the file is the truth.

## Out of scope

A database. One file is enough at this traffic.
MD

cat > tests/exports.test.js <<'JS'
import assert from "node:assert/strict";
import { test } from "node:test";
import { recordExport } from "../src/report/exports.js";

test("each export adds one to the stored count", () => {
  const before = recordExport();
  assert.equal(recordExport(), before + 1);
});
JS

cat > README.md <<'MD'
# gate

The sign-in API (`src/api/`), the nightly worker (`src/worker/`) and the
reports (`src/report/`) run in one Node process, restarted on every deploy.
`npm test` runs the suite.

## Designs

A ticket's design goes in `docs/specs/<ticket>.md`, for example
`docs/specs/CNT-7.md`, and its plan in `docs/plans/<ticket>.md`.
MD

git init --quiet
git add -A
git -c user.email=fixture@example.com -c user.name=fixture commit --quiet -m "gate 1.3.0"
