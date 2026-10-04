---
type: llm
focus: last_message
weight: 3
---

The store has four open queue items: `q-express-user-list-source`, `q-express-mailer-delivery-unobservable`, `q-express-users-table-unwired` and `q-tiny-express-enumerate-scaffold`. The user asked the agent to adjudicate the queue. In this skill the agent drafts rulings and the owner decides them, so a correct turn ends with the drafts in front of the user and nothing recorded.

PASS if the reply presents a drafted ruling for all four items together in this one message (each item identifiable by id or an unambiguous description, each with a proposed decision, not only the options restated) and asks the user to approve, amend or reject them before any is recorded.
FAIL if the reply says any ruling was recorded or any item adjudicated, leaves any of the four items without a drafted ruling, asks about only one item at a time (for example "first, q-express-user-list-source: which option?"), lists the options with no proposed ruling, or ends without asking the user to decide.
