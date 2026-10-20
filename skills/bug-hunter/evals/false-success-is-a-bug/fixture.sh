#!/usr/bin/env bash
# A project workspace registry whose close step derives the workspace name from
# the project's current title. The workspace was named from the title at open,
# so after a rename close removes nothing and still answers { ok: true }. The
# spec never mentions renaming a project and then closing it, which makes "should close
# find a workspace opened under the old title?" look like a question for
# product. It is not: whichever answer product gives, a close that reports
# success and left the workspace in place is wrong. This is the shape of the
# snowvault SNO-114 hunt, which filed `wt:remove -- SNO-n` after a rename as an
# ambiguity; review later found it released nothing and exited 0.
set -euo pipefail

mkdir -p src tests

cat > package.json <<'JSON'
{
  "name": "workspaces",
  "version": "2.3.0",
  "type": "module",
  "scripts": {
    "test": "node --test \"tests/*.test.js\""
  }
}
JSON

cat > SPEC.md <<'MD'
# Project workspaces

`src/workspaces.js` keeps a workspace for each open project. A project has a
key (`P-12`) that never changes and a title that can be renamed at any time.

- `openProject(state, key, title)` registers the project and creates its
  workspace.
- `renameProject(state, key, title)` changes the project's title.
- `closeProject(state, key)` removes the project's workspace and returns
  `{ ok: true }`. For a key that names no project it returns
  `{ ok: false, error: "unknown project" }`.
- `workspaceCount(state)` is the number of workspaces that exist.
MD

git init --quiet
git add -A
git -c user.email=fixture@example.com -c user.name=fixture commit --quiet -m "spec: project workspaces"

cat > src/workspaces.js <<'JS'
export function createState() {
  return { projects: new Map(), workspaces: new Set() };
}

function workspaceName(key, title) {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${key.toLowerCase()}-${slug}`;
}

export function openProject(state, key, title) {
  state.projects.set(key, { title });
  state.workspaces.add(workspaceName(key, title));
}

export function renameProject(state, key, title) {
  const project = state.projects.get(key);
  if (!project) return { ok: false, error: "unknown project" };
  project.title = title;
  return { ok: true };
}

export function closeProject(state, key) {
  const project = state.projects.get(key);
  if (!project) return { ok: false, error: "unknown project" };
  state.workspaces.delete(workspaceName(key, project.title));
  state.projects.delete(key);
  return { ok: true };
}

export function workspaceCount(state) {
  return state.workspaces.size;
}
JS

cat > tests/workspaces.test.js <<'JS'
import assert from "node:assert/strict";
import { test } from "node:test";
import { createState, openProject, renameProject, closeProject, workspaceCount } from "../src/workspaces.js";

test("opening a project creates its workspace", () => {
  const state = createState();
  openProject(state, "P-1", "Launch plan");
  assert.equal(workspaceCount(state), 1);
});

test("closing a project removes its workspace", () => {
  const state = createState();
  openProject(state, "P-1", "Launch plan");
  assert.deepEqual(closeProject(state, "P-1"), { ok: true });
  assert.equal(workspaceCount(state), 0);
});

test("renaming a project keeps it open", () => {
  const state = createState();
  openProject(state, "P-1", "Launch plan");
  assert.deepEqual(renameProject(state, "P-1", "Launch plan v2"), { ok: true });
  assert.equal(workspaceCount(state), 1);
});

test("closing an unknown key is refused", () => {
  const state = createState();
  assert.deepEqual(closeProject(state, "P-9"), { ok: false, error: "unknown project" });
});
JS

git add -A
git -c user.email=fixture@example.com -c user.name=fixture commit --quiet -m "feat: project workspaces"
