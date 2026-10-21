---
type: tool_order
# The check reads a finished plan in a fresh context, so it comes after the
# first validate run, and its brief names both documents in either order. An
# Agent that drafts the plan names both paths too and goes out before any
# validate, so it is the first after-match and fails the case: a run that hands
# the drafting to an agent is scored as one that never checked.
before: { tool: Bash, input_match: '"command"\s*:\s*"(?:(?:[^"\\]|\\.)*?(?:[\s/;&|(]|\\[nt]))?plan\.sh(?:\\"|'')?(?:\s|\\[nt])+validate(?:\s|\\[nt]|"|[;&|)>])' }
after: { tool: Agent, input_match: '^(?=[\s\S]*docs/specs/OPS-13\.md)(?=[\s\S]*docs/plans/OPS-13\.md)' }
weight: 2
---
