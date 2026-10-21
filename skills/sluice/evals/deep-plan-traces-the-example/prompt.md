---
name: deep-plan-traces-the-example
description: A deep plan whose ticket example contradicts the obvious design. Pins a Trace section in the spec that walks the example through the fixture's real data before sign-off.
tags: [routing, deep, write]
max_turns: 25
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write]
expected_outcome: Announces the deep channel, writes docs/specs/DEK-41.md with a Trace section that runs the ticket's sentence against the smoke deck, finds its slides have no accepted version, designs around that, and stops for sign-off without code.
---

Plan DEK-41 for us.

> Let people revise a single slide from chat. Example, on the smoke deck:
> "Redraft the Pilot Stages slide to lead with the pilot outcome" should redraft
> that slide and leave the rest alone. The chat router needs a revise intent;
> finding the slide and saving the redraft should reuse what the deck store and
> the redraft path already do.
