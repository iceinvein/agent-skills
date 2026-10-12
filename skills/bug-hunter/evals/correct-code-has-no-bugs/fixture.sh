#!/usr/bin/env bash
# A pagination helper that does everything SPEC.md says, limits included: the
# spec states every range and every error, and the code meets each one at its
# edge. The existing tests cover only the middle, so the boundaries are left
# for the hunt to probe and find correct. A bug reported here is a false
# positive.
set -euo pipefail

mkdir -p src tests

cat > package.json <<'JSON'
{
  "name": "listing",
  "version": "2.0.1",
  "type": "module",
  "scripts": {
    "test": "node --test \"tests/*.test.js\""
  }
}
JSON

cat > SPEC.md <<'MD'
# Listing

`paginate(items, page, perPage)` in `src/paginate.js` returns one page of a
list. Callers always pass an array as `items`; anything else is outside this
function's contract.

- Pages are numbered from 1. Page `n` holds the items at indexes
  `(n - 1) * perPage` up to but not including `n * perPage`.
- `perPage` is a whole number from 1 to 50, inclusive.
- `page` is a whole number of 1 or more.
- A `page` or `perPage` outside those ranges, or not a whole number, throws a
  `RangeError`.
- The last page may hold fewer than `perPage` items.
- A page past the last one returns an empty array.
- The result is a new array, and `items` is not modified.
MD

git init --quiet
git add -A
git -c user.email=fixture@example.com -c user.name=fixture commit --quiet -m "spec: listing pagination"

cat > src/paginate.js <<'JS'
const MAX_PER_PAGE = 50;

export function paginate(items, page, perPage) {
  if (!Number.isInteger(perPage) || perPage < 1 || perPage > MAX_PER_PAGE) {
    throw new RangeError(`perPage must be a whole number from 1 to ${MAX_PER_PAGE}, got ${perPage}`);
  }

  if (!Number.isInteger(page) || page < 1) {
    throw new RangeError(`page must be a whole number of 1 or more, got ${page}`);
  }

  const start = (page - 1) * perPage;
  return items.slice(start, start + perPage);
}
JS

cat > tests/paginate.test.js <<'JS'
import assert from "node:assert/strict";
import { test } from "node:test";
import { paginate } from "../src/paginate.js";

const letters = ["a", "b", "c", "d", "e", "f", "g"];

test("the first page holds the first perPage items", () => {
  assert.deepEqual(paginate(letters, 1, 3), ["a", "b", "c"]);
});

test("the second page continues where the first stopped", () => {
  assert.deepEqual(paginate(letters, 2, 3), ["d", "e", "f"]);
});

test("a fractional page throws", () => {
  assert.throws(() => paginate(letters, 1.5, 3), RangeError);
});
JS

git add -A
git -c user.email=fixture@example.com -c user.name=fixture commit --quiet -m "feat: paginate listings"
