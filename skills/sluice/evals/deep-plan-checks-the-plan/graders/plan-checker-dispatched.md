---
type: tool_order
# The check reads a finished plan in a fresh context, so it comes after the
# first validate run, and its brief names both documents in either order. An
# Agent that drafts the plan names both paths too, but it goes out before any
# plan exists to validate, so it cannot stand in for the check here.
before: { tool: Bash, input_match: '"command"\s*:\s*"(?:(?:[^"\\]|\\.)*?(?:[\s/;&|(]|\\[nt]))?plan\.sh(?:\\"|'')?(?:\s|\\[nt])+validate(?:\s|\\[nt]|"|[;&|)>])' }
after: { tool: Agent, input_match: '^(?=[\s\S]*docs/specs/OPS-13\.md)(?=[\s\S]*docs/plans/OPS-13\.md)' }
weight: 2
---
