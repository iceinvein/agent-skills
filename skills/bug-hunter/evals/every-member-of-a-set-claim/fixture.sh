#!/usr/bin/env bash
# A draft-source picker whose spec says every cited source it does not return
# is logged once with a reason. Sources are dropped at three sites: a cited id
# with no document, a document with no file name, and the five-slot cap. The
# cap is applied after the reader's own attachments are merged in first, but
# over_cap is only logged when the cited sources alone exceed five, so a cited
# source cut because attachments filled the slots leaves no log line. The
# existing tests cover each reason on the cited-only path. This is the shape
# of the snowvault SNO-54 hunt, which was given exactly this claim, checked
# behaviour against the base with 20,000 random cases, reported 0 bugs, and
# missed the attachment cut that the reviewer then found.
set -euo pipefail

mkdir -p src tests

cat > package.json <<'JSON'
{
  "name": "draft-sources",
  "version": "1.4.0",
  "type": "module",
  "scripts": {
    "test": "node --test \"tests/*.test.js\""
  }
}
JSON

cat > SPEC.md <<'MD'
# Draft sources

`pickSources({ attachments, citedIds, documents, log })` in `src/sources.js`
picks the documents that seed a draft.

- `attachments` are documents the reader attached; they always come first.
- `citedIds` are document ids the earlier answer cited, looked up in
  `documents` (an object keyed by id). Cited sources fill what is left.
- At most 5 documents are returned in all.
- A cited document with no `fileName` is not used.
- Every cited source that is not returned is logged once, as
  `log({ id, reason })`, where `reason` is one of `not_found`,
  `no_file_name` or `over_cap`.
MD

git init --quiet
git add -A
git -c user.email=fixture@example.com -c user.name=fixture commit --quiet -m "spec: draft sources"

cat > src/sources.js <<'JS'
const MAX_SOURCES = 5;

function citedSources(citedIds, documents, log) {
  const picked = [];
  for (const id of citedIds) {
    const doc = documents[id];
    if (!doc) {
      log({ id, reason: "not_found" });
      continue;
    }
    if (!doc.fileName) {
      log({ id, reason: "no_file_name" });
      continue;
    }
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
JS

cat > tests/sources.test.js <<'JS'
import assert from "node:assert/strict";
import { test } from "node:test";
import { pickSources } from "../src/sources.js";

const doc = (id) => ({ id, fileName: `${id}.pdf` });

function run(input) {
  const lines = [];
  const picked = pickSources({ attachments: [], documents: {}, ...input, log: (l) => lines.push(l) });
  return { ids: picked.map((d) => d.id), lines };
}

test("attachments come before cited sources", () => {
  const { ids } = run({ attachments: [doc("a1")], citedIds: ["c1"], documents: { c1: doc("c1") } });
  assert.deepEqual(ids, ["a1", "c1"]);
});

test("a cited id with no document is logged as not_found", () => {
  const { ids, lines } = run({ citedIds: ["c9"] });
  assert.deepEqual(ids, []);
  assert.deepEqual(lines, [{ id: "c9", reason: "not_found" }]);
});

test("a cited document with no file name is logged as no_file_name", () => {
  const { ids, lines } = run({ citedIds: ["c1"], documents: { c1: { id: "c1" } } });
  assert.deepEqual(ids, []);
  assert.deepEqual(lines, [{ id: "c1", reason: "no_file_name" }]);
});

test("cited sources beyond five are logged as over_cap", () => {
  const ids6 = ["c1", "c2", "c3", "c4", "c5", "c6"];
  const documents = Object.fromEntries(ids6.map((id) => [id, doc(id)]));
  const { ids, lines } = run({ citedIds: ids6, documents });
  assert.deepEqual(ids, ["c1", "c2", "c3", "c4", "c5"]);
  assert.deepEqual(lines, [{ id: "c6", reason: "over_cap" }]);
});
JS

git add -A
git -c user.email=fixture@example.com -c user.name=fixture commit --quiet -m "feat: pick draft sources"
