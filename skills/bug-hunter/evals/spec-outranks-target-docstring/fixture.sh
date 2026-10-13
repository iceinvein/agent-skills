#!/usr/bin/env bash
# A download list whose spec and whose own docstring disagree. SPEC.md says a
# sealed export stays on offer while its guide is rewritten in, and if that
# rewrite fails. The module's docstring, written with the code, says a sealed
# export whose rewrite failed is never offered, and the code follows the
# docstring. The spec is the intent; a comment inside the changed code is the
# change describing itself, so the disagreement is a bug citing the spec, not
# a question for product. This is the shape the pilot's workings-3a4c4b7f5
# key took, where the skill found the defect and filed it as an ambiguity.
# Everything else the spec says, the code does.
set -euo pipefail

mkdir -p src tests

cat > package.json <<'JSON'
{
  "name": "exports",
  "version": "2.4.0",
  "type": "module",
  "scripts": {
    "test": "node --test \"tests/*.test.js\""
  }
}
JSON

cat > SPEC.md <<'MD'
# Exports

`offeredExports(exports)` in `src/exports.js` returns the exports the
download list shows, keeping the order it was given. An export is
`{ id, sealed, hasGuide, rewrite }`, where `rewrite` is `"none"`,
`"running"` or `"failed"`.

- An export is offered once it is sealed. An unsealed export is not offered.
- A sealed export made before exports carried a guide (`hasGuide` false) has
  the guide written into it in the background. It stays on offer while that
  rewrite runs and if the rewrite fails: a sealed export is a complete proof
  with or without the guide.
MD

git init --quiet
git add -A
git -c user.email=fixture@example.com -c user.name=fixture commit --quiet -m "spec: which exports the download list offers"

cat > src/exports.js <<'JS'
/**
 * The exports the download list offers, in the order given. A sealed export
 * is offered. A sealed export without a guide whose rewrite failed is never
 * offered: without the guide it cannot be opened on its own.
 */
export function offeredExports(exports) {
  return exports.filter((entry) => {
    if (!entry.sealed) return false;
    if (!entry.hasGuide && entry.rewrite === "failed") return false;
    return true;
  });
}
JS

cat > tests/exports.test.js <<'JS'
import assert from "node:assert/strict";
import { test } from "node:test";
import { offeredExports } from "../src/exports.js";

test("a sealed export with a guide is offered", () => {
  const sealed = { id: "a", sealed: true, hasGuide: true, rewrite: "none" };
  assert.deepEqual(offeredExports([sealed]), [sealed]);
});

test("an unsealed export is not offered", () => {
  assert.deepEqual(offeredExports([{ id: "a", sealed: false, hasGuide: true, rewrite: "none" }]), []);
});

test("the order given is kept", () => {
  const a = { id: "a", sealed: true, hasGuide: true, rewrite: "none" };
  const b = { id: "b", sealed: true, hasGuide: true, rewrite: "none" };
  assert.deepEqual(offeredExports([b, a]), [b, a]);
});
JS

git add -A
git -c user.email=fixture@example.com -c user.name=fixture commit --quiet -m "feat: offer sealed exports for download"
