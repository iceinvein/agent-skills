#!/usr/bin/env bash
# A relay whose CLI, webhook handler and worker all reach one upstream client,
# so a ticket touching retries is a three-subsystem change. The ticket carries
# three numbered asks, and each one fixes its own numbers, so the run has no
# fork to ask about and the case reaches the written design, where it pins the
# Intent map and the fresh-context check of the spec against it. The README
# fixes where the design goes, so the graders can read it.
set -euo pipefail

mkdir -p src/cli src/webhook src/worker src/upstream tests docs/specs

cat > package.json <<'JSON'
{
  "name": "relay",
  "version": "0.6.0",
  "type": "module",
  "scripts": {
    "test": "node --test \"tests/*.test.js\""
  }
}
JSON

cat > src/upstream/client.js <<'JS'
const BASE = "https://api.upstream.example";

export async function call(path, body, fetchImpl = fetch) {
  const response = await fetchImpl(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`upstream ${response.status} on ${path}`);
  }

  return response.json();
}
JS

cat > src/cli/push.js <<'JS'
import { call } from "../upstream/client.js";

export async function push(records, log = console.log) {
  for (const record of records) {
    await call("/v1/records", record);
    log(`pushed ${record.id}`);
  }
}
JS

cat > src/cli/main.js <<'JS'
import { readFileSync } from "node:fs";
import { push } from "./push.js";

const [file] = process.argv.slice(2);
await push(JSON.parse(readFileSync(file, "utf8")));
JS

cat > src/webhook/handler.js <<'JS'
import { call } from "../upstream/client.js";

export async function handle(event) {
  const result = await call("/v1/events", { type: event.type, payload: event.payload });
  return { status: 202, id: result.id };
}
JS

cat > src/worker/backfill.js <<'JS'
import { call } from "../upstream/client.js";

export async function backfill(queue, log = console.log) {
  let sent = 0;

  while (queue.length > 0) {
    await call("/v1/records", queue.shift());
    sent += 1;
  }

  log(`backfill sent ${sent}`);
  return sent;
}
JS

cat > tests/upstream.test.js <<'JS'
import assert from "node:assert/strict";
import { test } from "node:test";
import { call } from "../src/upstream/client.js";

function fakeFetch(ok, body) {
  return async () => ({ ok, status: ok ? 200 : 429, json: async () => body });
}

test("a successful call returns the parsed body", async () => {
  const result = await call("/v1/records", { id: "a" }, fakeFetch(true, { id: "a" }));
  assert.deepEqual(result, { id: "a" });
});

test("a rejected call reports the status and the path", async () => {
  await assert.rejects(
    () => call("/v1/records", { id: "a" }, fakeFetch(false)),
    /upstream 429 on \/v1\/records/,
  );
});
JS

cat > README.md <<'MD'
# relay

Three callers, one upstream API: `src/cli/push.js`, `src/webhook/handler.js`
and `src/worker/backfill.js` all go through `src/upstream/client.js`. Each
caller logs through the `log` it is handed, which defaults to `console.log`.
`npm test` runs the suite.

## Designs

A ticket's design goes in `docs/specs/<ticket>.md`, for example
`docs/specs/OPS-12.md`, and its plan in `docs/plans/<ticket>.md`.
MD
touch docs/specs/.gitkeep

git init --quiet
git add -A
git -c user.email=fixture@example.com -c user.name=fixture commit --quiet -m "relay 0.6.0"
