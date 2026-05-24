#!/usr/bin/env bun
// Regenerate skills/index.json from each skills/*/skill.json.
//
// Source of truth per skill: skill.json (name, description, type, version).
// Preserved from the existing index.json (because they don't live in skill.json):
//   - applies: string[]   -> orchestration filter tag
//   - quick:   boolean    -> orchestration "fast pass" flag
//
// Run manually: bun run scripts/build-index.ts
// Run via npm:  bun run build:index
//
// Exit codes:
//   0 - index regenerated (or unchanged); writes file in place
//   1 - a skill.json is invalid or missing required fields

import { readdir } from "node:fs/promises";
import { join } from "node:path";

type IndexEntry = {
  name: string;
  description: string;
  type: string;
  version: string;
  applies?: string[];
  quick?: boolean;
};

const REPO_ROOT = new URL("..", import.meta.url).pathname;
const SKILLS_DIR = join(REPO_ROOT, "skills");
const INDEX_PATH = join(SKILLS_DIR, "index.json");

const REQUIRED_FIELDS: Array<keyof IndexEntry> = ["name", "description", "type", "version"];

async function loadExistingIndex(): Promise<Map<string, IndexEntry>> {
  const file = Bun.file(INDEX_PATH);
  if (!(await file.exists())) return new Map();
  const existing: IndexEntry[] = await file.json();
  return new Map(existing.map((e) => [e.name, e]));
}

async function listSkillDirs(): Promise<string[]> {
  const entries = await readdir(SKILLS_DIR, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

async function readSkillManifest(name: string): Promise<IndexEntry | null> {
  const path = join(SKILLS_DIR, name, "skill.json");
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  const data = await file.json();
  for (const field of REQUIRED_FIELDS) {
    if (!data[field]) {
      throw new Error(`skills/${name}/skill.json missing required field '${field}'`);
    }
  }
  return {
    name: data.name,
    description: data.description,
    type: data.type,
    version: data.version,
  };
}

async function main() {
  const existing = await loadExistingIndex();
  const dirs = await listSkillDirs();

  const built: IndexEntry[] = [];
  for (const dir of dirs) {
    const manifest = await readSkillManifest(dir);
    if (!manifest) continue; // skip dirs that aren't skills (no skill.json)

    const prior = existing.get(manifest.name);
    if (prior?.applies !== undefined) manifest.applies = prior.applies;
    if (prior?.quick !== undefined) manifest.quick = prior.quick;

    built.push(manifest);
  }

  const output = JSON.stringify(built, null, 2) + "\n";
  const previous = await Bun.file(INDEX_PATH).text().catch(() => "");

  await Bun.write(INDEX_PATH, output);

  if (output === previous) {
    console.log(`skills/index.json already up to date (${built.length} skills)`);
  } else {
    console.log(`skills/index.json regenerated (${built.length} skills)`);
  }
}

await main();
