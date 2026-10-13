#!/usr/bin/env bash
# A duration formatter whose spec gives the two display forms and never says
# how a fractional second rounds. The code floors the minutes and then rounds
# the remaining seconds, so 59.6 shows as "60s" and 119.7 as "1m 60s". The
# spec's silence on rounding is a real question, but no answer to it permits
# a seconds field of 60: flooring gives "59s" and "1m 59s", rounding gives
# "1m 0s" and "2m 0s". A result wrong under every reading of the silence is a
# bug, not an ambiguity. This is the shape of the pilot's formatDuration
# finding on workings-0c1703a05, which triage confirmed real.
set -euo pipefail

mkdir -p src tests

cat > package.json <<'JSON'
{
  "name": "video-summary",
  "version": "1.6.0",
  "type": "module",
  "scripts": {
    "test": "node --test \"tests/*.test.js\""
  }
}
JSON

cat > SPEC.md <<'MD'
# Video summary

`formatDuration(secs)` in `src/duration.js` gives a video's length for the
summary line. `secs` is the length in seconds, 0 or more. It is the frame
count over the frame rate, so it is often fractional.

- Under a minute, the length shows as `Ns`, for example `42s`.
- From a minute up, it shows as `Mm Ss`, for example `3m 5s`.
MD

git init --quiet
git add -A
git -c user.email=fixture@example.com -c user.name=fixture commit --quiet -m "spec: video length on the summary line"

cat > src/duration.js <<'JS'
export function formatDuration(secs) {
  const mins = Math.floor(secs / 60);
  const remainingSecs = Math.round(secs % 60);
  if (mins === 0) return `${remainingSecs}s`;
  return `${mins}m ${remainingSecs}s`;
}
JS

cat > tests/duration.test.js <<'JS'
import assert from "node:assert/strict";
import { test } from "node:test";
import { formatDuration } from "../src/duration.js";

test("under a minute shows seconds only", () => {
  assert.equal(formatDuration(42), "42s");
});

test("a minute or more shows minutes and seconds", () => {
  assert.equal(formatDuration(185), "3m 5s");
});

test("exactly a minute shows as 1m 0s", () => {
  assert.equal(formatDuration(60), "1m 0s");
});
JS

git add -A
git -c user.email=fixture@example.com -c user.name=fixture commit --quiet -m "feat: format a video's length"
