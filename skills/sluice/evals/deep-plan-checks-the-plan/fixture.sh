#!/usr/bin/env bash
# A relay whose design for OPS-13 is already written and signed off, with three
# numbered decisions and an Out of scope section, so the run starts at the plan
# stop. The case pins what the plan owes its spec: a Spec line, a Builds line
# on every task covering D1 to D3, `plan.sh validate` run on it, and a
# fresh-context check of plan against spec before the pre-flight questions.
# The README fixes where the plan goes, so the graders can read it.
set -euo pipefail

mkdir -p src/cli src/webhook src/worker src/upstream tests docs/specs docs/plans

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

cat > docs/specs/OPS-13.md <<'MD'
# Design: OPS-13 retry upstream 429s

Signed off by the partner on 2026-10-20.

## Intent

The ticket, verbatim:

> 1. Every upstream call retries a 429, up to three attempts in all, waiting the
>    number of seconds in the `Retry-After` header between them.
> 2. Each retry is logged by the caller that made the call, with the path and
>    the attempt number.
> 3. The CLI gets a `--no-retry` flag.
> 4. The webhook handler gets its own retry budget.

| Ask | Decision |
|---|---|
| 1. Retry a 429 | D1 |
| 2. Log each retry in the caller | D2 |
| 3. `--no-retry` on the CLI | D3 |
| 4. A webhook retry budget | Out of scope |

## Context

- `src/upstream/client.js` is the one path to the upstream API; the CLI
  (`src/cli/push.js`), the webhook (`src/webhook/handler.js`) and the worker
  (`src/worker/backfill.js`) all call `call`.
- Each caller logs through the `log` it is handed, defaulting to `console.log`.

### D1. The client retries a 429

`call(path, body, fetchImpl, options)` retries a 429 response up to three
attempts in all, sleeping `Retry-After` seconds between attempts through an
injected `sleep` so tests do not wait. `options.retry === false` makes one
attempt only. Any other status throws as it does today.

### D2. Callers log each retry

`call` takes `options.onRetry(path, attempt)`. The CLI and the worker pass one
that writes `retry <path> attempt <n>` through their `log`; the webhook passes
one that writes the same line through `console.log`.

### D3. The CLI takes --no-retry

`src/cli/main.js` reads `--no-retry` from its arguments and passes
`{ retry: false }` through `push` to `call`.

## Out of scope

A separate retry budget for the webhook handler: the webhook's upstream
traffic is a small fraction of the total, and one shared policy is enough
until it is not.
MD

cat > README.md <<'MD'
# relay

Three callers, one upstream API: `src/cli/push.js`, `src/webhook/handler.js`
and `src/worker/backfill.js` all go through `src/upstream/client.js`.
`npm test` runs the suite.

## Designs

A ticket's design goes in `docs/specs/<ticket>.md`, for example
`docs/specs/OPS-13.md`, and its plan in `docs/plans/<ticket>.md`.
MD
touch docs/plans/.gitkeep

git init --quiet
git add -A
git -c user.email=fixture@example.com -c user.name=fixture commit --quiet -m "relay 0.6.0"
