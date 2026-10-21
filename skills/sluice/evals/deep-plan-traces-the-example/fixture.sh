#!/usr/bin/env bash
# A deck app where the ticket's own example fails the obvious design. The deck
# store looks slides up by the title of their accepted version, and only the
# canvas ever accepts one, so the smoke deck, built in chat, has no accepted
# slides and the lookup the ticket says to reuse finds nothing. Nothing in the
# code is wrong; the trap is in designing from which functions exist instead of
# walking the example through the data. The README fixes where the design goes, so the graders can read it,
# what an unaccepted slide is called, and what writes slide text, because
# without them each is a fork the run rightly asks before writing any design.
set -euo pipefail

mkdir -p src/chat src/deck src/canvas data/decks tests docs/specs

cat > package.json <<'JSON'
{
  "name": "decks",
  "version": "0.9.0",
  "type": "module",
  "scripts": {
    "test": "node --test \"tests/*.test.js\""
  }
}
JSON

cat > src/deck/store.js <<'JS'
import { readFileSync, writeFileSync } from "node:fs";

const path = (id) => new URL(`../../data/decks/${id}.json`, import.meta.url);

export function loadDeck(id) {
  return JSON.parse(readFileSync(path(id), "utf8"));
}

export function saveDeck(deck) {
  writeFileSync(path(deck.id), JSON.stringify(deck, null, 2) + "\n");
}

// A slide's title is the title of the version the user accepted on the canvas.
export function findSlideByTitle(deck, title) {
  const wanted = title.trim().toLowerCase();
  return deck.slides.find((slide) => {
    const accepted = slide.versions[slide.accepted];
    return accepted !== undefined && accepted.title.toLowerCase() === wanted;
  });
}
JS

cat > src/deck/redraft.js <<'JS'
// Appends a new version; the canvas decides whether the user accepts it.
export function redraftSlide(slide, draft) {
  slide.versions.push({ title: draft.title, body: draft.body });
  return slide.versions.length - 1;
}
JS

cat > src/deck/draft.js <<'JS'
// Slide text comes from the model; callers pass the completion so tests can stub it.
export async function draftSlide(version, instruction, complete) {
  const text = await complete(
    `Rewrite this slide. ${instruction}\nTitle: ${version.title}\nBody: ${version.body}`,
  );
  const [title, ...body] = text.trim().split("\n");
  return { title: title.replace(/^Title:\s*/, ""), body: body.join("\n").replace(/^Body:\s*/, "") };
}
JS

cat > src/canvas/accept.js <<'JS'
export function accept(slide, versionIndex) {
  if (slide.versions[versionIndex] === undefined) {
    throw new Error(`no version ${versionIndex} on slide ${slide.id}`);
  }
  slide.accepted = versionIndex;
}
JS

cat > src/chat/build-deck.js <<'JS'
export function buildDeck(id, outline) {
  return {
    id,
    slides: outline.map((item, index) => ({
      id: `s${index + 1}`,
      accepted: null,
      versions: [{ title: item.title, body: item.body }],
    })),
  };
}
JS

cat > src/chat/router.js <<'JS'
export function route(message) {
  if (/^(prepare|build|make)\b.*\bslides?\b/i.test(message)) {
    return { intent: "build-deck" };
  }
  return { intent: "chat" };
}
JS

cat > data/decks/smoke.json <<'JSON'
{
  "id": "smoke",
  "slides": [
    {
      "id": "s1",
      "accepted": null,
      "versions": [{ "title": "Why a pilot", "body": "Three sites asked for it." }]
    },
    {
      "id": "s2",
      "accepted": null,
      "versions": [{ "title": "Pilot Stages", "body": "Recruit, run for six weeks, review." }]
    },
    {
      "id": "s3",
      "accepted": null,
      "versions": [{ "title": "Next steps", "body": "Pick the sites by May." }]
    }
  ]
}
JSON

cat > tests/store.test.js <<'JS'
import assert from "node:assert/strict";
import { test } from "node:test";
import { findSlideByTitle } from "../src/deck/store.js";

test("a slide is found by the title of its accepted version", () => {
  const deck = { slides: [{ id: "s1", accepted: 0, versions: [{ title: "Pilot Stages" }] }] };
  assert.equal(findSlideByTitle(deck, "pilot stages").id, "s1");
});
JS

cat > README.md <<'MD'
# decks

Chat builds a deck (`src/chat/build-deck.js`), the canvas lets a user accept a
slide version (`src/canvas/accept.js`), and the deck store reads and writes
`data/decks/<id>.json`. Until a user accepts a version, a slide shows, and is
called by, its latest one. Slide text, for a new deck or a redraft, comes from
`draftSlide` in `src/deck/draft.js`. `data/decks/smoke.json` is the smoke deck QA runs
tickets against. `npm test` runs the suite.

## Designs

A ticket's design goes in `docs/specs/<ticket>.md`, for example
`docs/specs/DEK-12.md`, and its plan in `docs/plans/<ticket>.md`.
MD
touch docs/specs/.gitkeep

git init --quiet
git add -A
git -c user.email=fixture@example.com -c user.name=fixture commit --quiet -m "decks 0.9.0"
