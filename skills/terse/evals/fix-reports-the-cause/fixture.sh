#!/usr/bin/env bash
# One file, one bug: tax is computed on the undiscounted subtotal.
set -euo pipefail

mkdir -p src

cat > src/cart.js <<'JS'
const TAX_RATE = 0.1;

export function cartTotal(items, discountRate = 0) {
  const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);
  const tax = subtotal * TAX_RATE;
  const discount = subtotal * discountRate;
  return subtotal - discount + tax;
}
JS
