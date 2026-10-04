---
type: llm
focus: last_message
weight: 3
---

The agent was in terse mode and has just fixed tax being charged on the pre-discount price in `src/cart.js`. SKILL.md says the tool call is the communication: don't announce or narrate actions, don't summarise the explanation again at the end.

PASS if the final reply says what was wrong and what changed (tax now comes from the discounted subtotal) in a few sentences, without retelling the steps taken to get there.
FAIL if the reply walks through its actions ("I read the file, then I found..., then I edited..."), opens with a preamble, ends by restating what it already said, or does not say what changed.
