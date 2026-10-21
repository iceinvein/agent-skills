---
type: tool_order
# The check reads a drafted design in a fresh context, so it comes after the
# first Write of the draft: the spec file, or the harness's plan file under plan
# mode, which is where the reference says the draft lives until sign-off. Its
# brief names that draft and the Intent it checks against, so the ground read,
# which goes out before any draft exists, cannot stand in for it.
before: { tool: Write, input_match: '"file_path"\s*:\s*"[^"]*(?:docs/specs/OPS-12\.md|/\.claude/plans/[^"]*\.md)"' }
after: { tool: Agent, input_match: '^(?=[\s\S]*(?:OPS-12\.md|/\.claude/plans/))(?=[\s\S]*Intent)' }
weight: 2
---
