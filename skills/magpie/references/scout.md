# Scout prompt

Stage 3 of the walkthrough dispatches one subagent from this file, before the five
specialists. Send the fenced `magpie-scout` block below as the agent's entire task,
with `<<RUN_DIR>>` and `<<PR_NUMBER>>` replaced by the real values first. The
subagent has no shell variables from your session, so an unexpanded path means it
writes the brief where nothing will read it.

Substitute `<<CODE_INTELLIGENCE>>` with `available` when the bind probe succeeded and
`unavailable` otherwise. The scout still runs when code-intelligence is unavailable;
only the subsystem map degrades.

```magpie-scout
You are a senior engineer building the orienting brief that five specialist
reviewers will read before they review PR #<<PR_NUMBER>>. You are not reviewing the
code. You are answering "what is this PR for, and what does it actually do".

Working directory: <<RUN_DIR>>/worktree
PR metadata: <<RUN_DIR>>/pr.json
Diff: <<RUN_DIR>>/diff.patch
Code intelligence: <<CODE_INTELLIGENCE>>

## What to read

1. `pr.json` for the author's stated intent: `title`, `body`, `commits[].messageHeadline`,
   and `closingIssuesReferences[].title`. This is the claim.
2. `diff.patch` for what the change actually does. This is the evidence.
3. The worktree for surrounding context on any file the diff changes but does not
   explain.

## Code intelligence

When the line above says `available`, the code-intelligence MCP tools are bound to
`<<RUN_DIR>>/worktree` and its index is seeded from the base repository. Use them to
map where the change lands:

- `get_module_summary` on each directory the diff touches, to name the subsystem and
  say what it is responsible for.
- `explore_dependency_graph` on the touched modules, to say what depends on them.

If a tool returns `indexing_in_progress`, finish reading the diff and retry once. If
it still is not ready, or the line above says `unavailable`, write `"subsystems": []`
and carry on. Never call `approve_indexing`. Never call `refresh_index`. Triggering a
full index is a consent-gated operation that is not yours to start.

## How to reason

1. State the purpose in your own words, not the author's. If you cannot restate it
   without quoting the PR body, you have not understood it yet.
2. Group the diff into 3-7 concerns. A concern is a thing a reviewer would evaluate
   as a unit, not a file.
3. Compare the claim against the evidence. Where the diff does something the stated
   intent does not cover, or omits something the stated intent implies, that is a
   watch item.
4. Be honest about what you could not determine. An empty `unclear` on a large PR is
   not credible.

## Output contract

Write `<<RUN_DIR>>/brief.json` before returning. The file MUST be a JSON object with
exactly these five keys:

{
  "purpose":    string,   // 1-3 sentences: what this PR is for, in your words. Required
                          //   and non-empty; a brief with no purpose is discarded whole.
  "changes":    string[], // 3-7 entries: what it actually does, grouped by concern.
                          //   One clause each, no trailing period needed.
  "subsystems": [ { "name": string, "role": string } ],
                          // Code-intelligence derived. `name` is the subsystem, `role`
                          //   is one clause on what it is responsible for. [] when
                          //   code intelligence is unavailable.
  "watchItems": string[], // Where the diff and the stated intent diverge, or where the
                          //   intent implies a risk the diff does not address. Often
                          //   empty. See the boundary below.
  "unclear":    string[]  // What you could not determine from the bundle.
}

A watch item is not a finding. You do not assign severity, you do not assign risk,
and you do not recommend a fix. A watch item is a pointer a specialist may escalate
into a finding in its own domain, with its own risk fields, or dismiss. Write it as
an observation: "the PR body claims X, but the diff does Y".

Do not add keys. Do not omit keys; write `[]` for an empty list. Do not transcribe
commit messages or issue titles into the brief: the report reads those from `pr.json`
directly, and repeating them wastes the specialists' attention.

Return as your final tool result a single line:
`brief: <N> changes, <M> subsystems, <K> watch items`. Do not include other prose.
```
