#!/usr/bin/env bash
# A paging helper with a planted bug the new function's contract exposes:
# lastPage floors where it must round up, so any total that is not a multiple
# of the page size loses its last page. The suite only covers exact multiples,
# so it starts green and the bug is there for the hunt to prove.
set -euo pipefail

mkdir -p src tests

cat > package.json <<'JSON'
{
  "name": "listing",
  "version": "0.4.0",
  "type": "module",
  "scripts": {
    "test": "node --test \"tests/*.test.js\""
  }
}
JSON

cat > src/paging.js <<'JS'
// Pages are 1-based and hold `size` items each.

export function lastPage(total, size) {
  return Math.floor(total / size);
}
JS

cat > src/footer.js <<'JS'
import { lastPage } from "./paging.js";

export function footer(page, total, size) {
  return `page ${page} of ${lastPage(total, size)}`;
}
JS

cat > tests/paging.test.js <<'JS'
import assert from "node:assert/strict";
import { test } from "node:test";
import { lastPage } from "../src/paging.js";
import { footer } from "../src/footer.js";

test("twenty items in pages of ten end on page two", () => {
  assert.equal(lastPage(20, 10), 2);
});

test("thirty items in pages of five end on page six", () => {
  assert.equal(lastPage(30, 5), 6);
});

test("the footer names the last page", () => {
  assert.equal(footer(1, 20, 10), "page 1 of 2");
});
JS

cat > README.md <<'MD'
# listing

Paged listings. `npm test` runs the suite.
MD

git init --quiet
git add -A
git -c user.email=fixture@example.com -c user.name=fixture commit --quiet -m "listing 0.4.0"
