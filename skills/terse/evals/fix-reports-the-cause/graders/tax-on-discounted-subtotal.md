---
type: llm
focus: trace
weight: 2
---

`src/cart.js` computed tax on the subtotal before the discount. The user asked for tax to be charged on the discounted price.

PASS if the agent edited `src/cart.js` so that tax is computed from the subtotal after the discount is taken off (for example `(subtotal - discount) * TAX_RATE`), and the function still returns the discounted subtotal plus that tax.
FAIL if the file was not edited, the tax is still computed from the pre-discount subtotal, or the change alters the result for carts with no discount.
