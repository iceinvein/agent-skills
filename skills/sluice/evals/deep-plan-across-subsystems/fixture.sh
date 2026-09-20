#!/usr/bin/env bash
# Smallest repo that makes the rate limiter a real three-subsystem change: a
# CLI, a webhook handler and a worker, each calling the same upstream client,
# and nothing between them and the API.
set -euo pipefail

mkdir -p src/cli src/webhook src/worker src/upstream tests

cat > package.json <<'JSON'
{
  "name": "relay",
  "version": "0.4.0",
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

cat > src/webhook/handler.js <<'JS'
import { call } from "../upstream/client.js";

export async function handle(event) {
  const result = await call("/v1/events", { type: event.type, payload: event.payload });
  return { status: 202, id: result.id };
}
JS

cat > src/worker/backfill.js <<'JS'
import { call } from "../upstream/client.js";

export async function backfill(queue) {
  let sent = 0;

  while (queue.length > 0) {
    await call("/v1/records", queue.shift());
    sent += 1;
  }

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
and `src/worker/backfill.js` all go through `src/upstream/client.js`.
`npm test` runs the suite.
MD

git init --quiet
git add -A
git -c user.email=fixture@example.com -c user.name=fixture commit --quiet -m "relay 0.4.0"
