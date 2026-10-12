#!/usr/bin/env bash
# A cart whose spec says a line's quantity is capped and never says where. The
# code caps at 99, so a scenario at 99, 100 or 150 has no expected value any
# claim can supply: the cap's value is a question for product, not a bug. The
# spec names the cap rather than staying silent about large quantities
# altogether, because a spec that only says "setting a quantity replaces the
# line's quantity" makes any cap a violation of that claim, and the right
# answer would no longer be clear. Everything the spec does settle, the code
# does, so a bug here is the skill inventing an expected value.
set -euo pipefail

mkdir -p src tests

cat > package.json <<'JSON'
{
  "name": "cart",
  "version": "1.2.0",
  "type": "module",
  "scripts": {
    "test": "node --test \"tests/*.test.js\""
  }
}
JSON

cat > SPEC.md <<'MD'
# Cart

`setQuantity(cart, sku, quantity)` in `src/cart.js` sets how many of one
product a cart line holds and returns the new cart. A cart is
`{ lines: [{ sku, quantity }] }`.

- The cart passed in is not modified.
- Setting the quantity of a SKU already in the cart replaces that line's
  quantity, and the line keeps its place.
- Setting the quantity of a SKU not in the cart adds a line at the end.
- Setting a quantity of 0 removes the line. Doing so for a SKU not in the cart
  returns a cart with the same lines.
- A quantity that is negative or not a whole number throws a `RangeError`.
- A line's quantity is capped so that a slip on the keyboard cannot order a
  pallet: setting a quantity above the cap stores the cap.
MD

git init --quiet
git add -A
git -c user.email=fixture@example.com -c user.name=fixture commit --quiet -m "spec: cart quantities"

cat > src/cart.js <<'JS'
const MAX_QUANTITY = 99;

export function setQuantity(cart, sku, quantity) {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new RangeError(`quantity must be a whole number of 0 or more, got ${quantity}`);
  }

  const stored = Math.min(quantity, MAX_QUANTITY);
  const index = cart.lines.findIndex((line) => line.sku === sku);

  if (stored === 0) {
    return { ...cart, lines: cart.lines.filter((line) => line.sku !== sku) };
  }

  if (index === -1) {
    return { ...cart, lines: [...cart.lines, { sku, quantity: stored }] };
  }

  const lines = cart.lines.map((line, i) => (i === index ? { ...line, quantity: stored } : line));
  return { ...cart, lines };
}
JS

cat > tests/cart.test.js <<'JS'
import assert from "node:assert/strict";
import { test } from "node:test";
import { setQuantity } from "../src/cart.js";

test("a new SKU is added as a line", () => {
  const cart = setQuantity({ lines: [] }, "mug", 2);
  assert.deepEqual(cart, { lines: [{ sku: "mug", quantity: 2 }] });
});

test("an existing line's quantity is replaced", () => {
  const cart = setQuantity({ lines: [{ sku: "mug", quantity: 2 }] }, "mug", 5);
  assert.deepEqual(cart, { lines: [{ sku: "mug", quantity: 5 }] });
});

test("a quantity of 0 removes the line", () => {
  const cart = setQuantity({ lines: [{ sku: "mug", quantity: 2 }] }, "mug", 0);
  assert.deepEqual(cart, { lines: [] });
});

test("a negative quantity throws", () => {
  assert.throws(() => setQuantity({ lines: [] }, "mug", -1), RangeError);
});
JS

git add -A
git -c user.email=fixture@example.com -c user.name=fixture commit --quiet -m "feat: set a cart line's quantity"
