---
name: deep-plan-checks-the-intent
description: A deep plan from a ticket with three numbered asks. Pins an Intent section that maps each ask to a decision or to Out of scope, a fresh-context check of the spec against it, and a sign-off message that reports the check.
tags: [routing, deep, write]
max_turns: 30
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Skill, Write, Agent]
expected_outcome: Announces the deep channel, writes docs/specs/OPS-12.md with an Intent section quoting the ticket and mapping each of its three asks, dispatches an agent to check the spec against that intent, and stops for sign-off saying what the check found.
---

Plan OPS-12 for us. The design goes in `docs/specs/OPS-12.md`.

> Upstream has started answering 429 under load, and we lose records when it does.
>
> 1. Every upstream call retries a 429, up to three attempts in all, waiting the
>    number of seconds in the `Retry-After` header between them.
> 2. Each retry is logged by the caller that made the call, with the path and
>    the attempt number.
> 3. The CLI gets a `--no-retry` flag for operators who would rather see the
>    429 straight away.
