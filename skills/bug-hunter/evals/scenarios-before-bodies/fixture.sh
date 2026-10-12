#!/usr/bin/env bash
# A coupon helper whose only bug is in its rounding (the spec says halves
# round up, the code floors). The case is about order, not the bug: the
# scenarios have to be on disk before anything opens src/discount.js, so
# their expected values come from SPEC.md rather than from the floor in the
# body.
set -euo pipefail

mkdir -p src tests

cat > package.json <<'JSON'
{
  "name": "checkout",
  "version": "3.1.0",
  "type": "module",
  "scripts": {
    "test": "node --test \"tests/*.test.js\""
  }
}
JSON

cat > SPEC.md <<'MD'
# Checkout coupons

`applyCoupon(totalCents, coupon)` in `src/discount.js` returns the order total
after a percentage coupon, in cents.

- `totalCents` is a whole number of 0 or more; anything else throws a
  `RangeError`.
- A coupon is `{ percentOff }`, where `percentOff` is a whole number from 1 to
  100, inclusive; anything else throws a `RangeError`.
- The result is the total less `percentOff` percent, rounded to the nearest
  cent, with a half cent rounding up.
MD

git init --quiet
git add -A
git -c user.email=fixture@example.com -c user.name=fixture commit --quiet -m "spec: checkout coupons"

cat > src/discount.js <<'JS'
export function applyCoupon(totalCents, coupon) {
  if (!Number.isInteger(totalCents) || totalCents < 0) {
    throw new RangeError(`totalCents must be a whole number of 0 or more, got ${totalCents}`);
  }

  const percentOff = coupon?.percentOff;

  if (!Number.isInteger(percentOff) || percentOff < 1 || percentOff > 100) {
    throw new RangeError(`percentOff must be a whole number from 1 to 100, got ${percentOff}`);
  }

  return Math.floor((totalCents * (100 - percentOff)) / 100);
}
JS

cat > tests/discount.test.js <<'JS'
import assert from "node:assert/strict";
import { test } from "node:test";
import { applyCoupon } from "../src/discount.js";

test("ten percent off a round total", () => {
  assert.equal(applyCoupon(10000, { percentOff: 10 }), 9000);
});

test("a coupon over 100 percent throws", () => {
  assert.throws(() => applyCoupon(10000, { percentOff: 101 }), RangeError);
});
JS

git add -A
git -c user.email=fixture@example.com -c user.name=fixture commit --quiet -m "feat: apply percentage coupons at checkout"
