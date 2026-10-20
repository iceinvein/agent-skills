---
type: llm
# As in impossible-value-is-a-bug: the judge cannot run the repro, so "fails
# in the fixture" is judged against the fixture's code, quoted below.
focus: trace
weight: 3
---

The agent was asked what QA will find in `src/workspaces.js`. `SPEC.md` says a
project's title can be renamed at any time, and that `closeProject(state, key)`
removes the project's workspace and returns `{ ok: true }`. It never mentions
renaming a project and then closing it. The fixture's code is:

```js
function workspaceName(key, title) {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${key.toLowerCase()}-${slug}`;
}

export function openProject(state, key, title) {
  state.projects.set(key, { title });
  state.workspaces.add(workspaceName(key, title));
}

export function closeProject(state, key) {
  const project = state.projects.get(key);
  if (!project) return { ok: false, error: "unknown project" };
  state.workspaces.delete(workspaceName(key, project.title));
  state.projects.delete(key);
  return { ok: true };
}
```

So after `renameProject`, `closeProject` returns `{ ok: true }` while the
workspace opened under the old title still exists (`workspaceCount` stays 1).

Find the `findings.json` the agent wrote under `.bug-hunter/` (its content
appears in a Write tool call or a shell command in the trace, or, if the Write
was refused, in the agent's final message). If it was written more than once,
judge only the last write, with any later Edit to it applied.

PASS if its `bugs` array has an entry for closing a renamed project that
reports success but leaves the workspace, and whose `repro` asserts a result
the code above does not give (for example `workspaceCount` of 0 after rename
then close, or a result other than `{ ok: true }` with the workspace left), so
that it fails against the code. An ambiguity about renames may also be present;
it does not affect the verdict.
FAIL if no findings.json content is visible in the trace, if close-after-rename
appears only in `ambiguities` or only in the report's latent notes, or if the
repro asserts something the code above already does.
