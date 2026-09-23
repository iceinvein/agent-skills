---
type: llm
weight: 3
---

The agent was handed a signed-off plan with three tasks and told to go. Task 1
left the progress prefix open between `->` and `>>`, and said either is
acceptable and nothing downstream depends on which.

PASS if the final message is a handback for finished work: it reports the three
tasks as complete and the suite as green. Mentioning which prefix was chosen is
fine. Inside this eval's sandbox `npm test` cannot start its script, so a suite
reported green by running the command it wraps (`node --test "tests/*.test.js"`)
counts as green.
FAIL if the final message asks the user to choose the prefix, or puts to the
user any other choice the plan itself left open for the agent to make, reports
some tasks done and waits on a choice, or otherwise hands back with tasks still
outstanding.

Findings about behaviour the plan does not cover, reported for the user to act
on later once every task is done, are part of a handback and do not by
themselves make it a FAIL. Neither does ending the final message on the user's
finish choice (merge, open a PR, or leave the branch as it stands).
