#!/usr/bin/env bash
# A username check with one bug, at the limit SPEC.md states: the spec says 3
# to 20 characters inclusive and the code rejects a name of exactly 20. The
# existing tests pass because none of them sits on the upper edge, which is
# the gap a scenario written from the spec should land on. Everything else the
# spec says, the code does, so the boundary is the only true finding.
set -euo pipefail

mkdir -p src tests

cat > package.json <<'JSON'
{
  "name": "signup",
  "version": "0.3.0",
  "type": "module",
  "scripts": {
    "test": "node --test \"tests/*.test.js\""
  }
}
JSON

cat > SPEC.md <<'MD'
# Signup

## Usernames

`isValidUsername(name)` in `src/username.js` decides whether the signup form
accepts a username.

- A username is 3 to 20 characters long, inclusive.
- It contains only ASCII letters, digits and underscores.
- Anything that is not a string is rejected.
- The function returns `true` or `false`; it never throws.
MD

git init --quiet
git add -A
git -c user.email=fixture@example.com -c user.name=fixture commit --quiet -m "spec: signup usernames"

cat > src/username.js <<'JS'
const ALLOWED = /^[A-Za-z0-9_]+$/;

export function isValidUsername(name) {
  if (typeof name !== "string") {
    return false;
  }

  if (name.length < 3 || name.length >= 20) {
    return false;
  }

  return ALLOWED.test(name);
}
JS

cat > tests/username.test.js <<'JS'
import assert from "node:assert/strict";
import { test } from "node:test";
import { isValidUsername } from "../src/username.js";

test("an ordinary name is accepted", () => {
  assert.equal(isValidUsername("alice_01"), true);
});

test("a two-character name is rejected", () => {
  assert.equal(isValidUsername("ab"), false);
});

test("a name with a space is rejected", () => {
  assert.equal(isValidUsername("bad name"), false);
});

test("a number is rejected", () => {
  assert.equal(isValidUsername(42), false);
});
JS

git add -A
git -c user.email=fixture@example.com -c user.name=fixture commit --quiet -m "feat: validate usernames at signup"
