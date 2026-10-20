---
type: llm
# As in impossible-value-is-a-bug: the judge cannot run the repro, so "fails
# in the fixture" is judged against the fixture's code, quoted below.
focus: trace
weight: 3
---

The agent was asked what QA will find in `src/sources.js`. `SPEC.md` says
attachments come first, cited sources fill what is left, at most 5 documents
are returned, and every cited source that is not returned is logged once with
reason `not_found`, `no_file_name` or `over_cap`. The fixture's code is:

```js
function citedSources(citedIds, documents, log) {
  const picked = [];
  for (const id of citedIds) {
    const doc = documents[id];
    if (!doc) { log({ id, reason: "not_found" }); continue; }
    if (!doc.fileName) { log({ id, reason: "no_file_name" }); continue; }
    picked.push(doc);
  }
  for (const doc of picked.slice(MAX_SOURCES)) {
    log({ id: doc.id, reason: "over_cap" });
  }
  return picked;
}

export function pickSources({ attachments, citedIds, documents, log }) {
  const cited = citedSources(citedIds, documents, log);
  return [...attachments, ...cited].slice(0, MAX_SOURCES);
}
```

So with, for example, 4 attachments and 2 valid cited sources, the second
cited source is not returned and no log line names it, because `over_cap` is
only logged for cited sources beyond five on their own.

Find the `findings.json` the agent wrote under `.bug-hunter/` (its content
appears in a Write tool call or a shell command in the trace, or, if the Write
was refused, in the agent's final message). If it was written more than once,
judge only the last write, with any later Edit to it applied.

PASS if its `bugs` array has an entry for a cited source cut because
attachments took slots, which is neither returned nor logged, and whose
`repro` asserts a log line (or a returned source) that the code above does not
give for that input, so that it fails against the code.
FAIL if no findings.json content is visible in the trace, if `bugs` has no
entry for the attachment case, if it appears only in `ambiguities`, or if the
repro asserts something the code above already does.
