#!/usr/bin/env bun
// Regenerate skills/index.json and .claude-plugin/marketplace.json from each
// skills/*/skill.json.
//
// Source of truth per skill: skill.json (name, description, type, version,
// plus author and tools for the marketplace).
// Preserved from the existing index.json (because they don't live in skill.json):
//   - applies: string[]   -> orchestration filter tag
//   - quick:   boolean    -> orchestration "fast pass" flag
//
// Run manually: bun run scripts/build-index.ts
// Run via npm:  bun run build:index
//
// Exit codes:
//   0 - both files regenerated (or unchanged); written in place
//   1 - a skill.json is invalid or missing required fields; neither file is written

import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { buildMarketplace, type SkillManifest } from "./marketplace";

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
const MARKETPLACE_DIR = join(REPO_ROOT, ".claude-plugin");
const MARKETPLACE_PATH = join(MARKETPLACE_DIR, "marketplace.json");

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

async function readSkillManifest(name: string): Promise<SkillManifest & { type: string } | null> {
  const path = join(SKILLS_DIR, name, "skill.json");
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  const data = await file.json();
  for (const field of REQUIRED_FIELDS) {
    if (!data[field]) {
      throw new Error(`skills/${name}/skill.json missing required field '${field}'`);
    }
  }
  if (typeof data.author !== "string" || data.author === "") {
    throw new Error(`skills/${name}/skill.json missing required field 'author'`);
  }
  if (!Array.isArray(data.tools) || !data.tools.every((tool: unknown) => typeof tool === "string")) {
    throw new Error(`skills/${name}/skill.json missing required field 'tools'`);
  }
  return data;
}

async function writeIfChanged(path: string, label: string, output: string, summary: string) {
  const previous = await Bun.file(path).text().catch(() => "");
  await Bun.write(path, output);
  if (output === previous) {
    console.log(`${label} already up to date (${summary})`);
  } else {
    console.log(`${label} regenerated (${summary})`);
  }
}

async function main() {
  const existing = await loadExistingIndex();
  const dirs = await listSkillDirs();

  const manifests: SkillManifest[] = [];
  const built: IndexEntry[] = [];
  for (const dir of dirs) {
    const manifest = await readSkillManifest(dir);
    if (!manifest) continue; // skip dirs that aren't skills (no skill.json)
    manifests.push(manifest);

    const entry: IndexEntry = {
      name: manifest.name,
      description: manifest.description,
      type: manifest.type,
      version: manifest.version,
    };
    const prior = existing.get(entry.name);
    if (prior?.applies !== undefined) entry.applies = prior.applies;
    if (prior?.quick !== undefined) entry.quick = prior.quick;

    built.push(entry);
  }

  // Built before either write so a failure leaves both files as they were.
  const marketplace = buildMarketplace(manifests);

  await writeIfChanged(INDEX_PATH, "skills/index.json", JSON.stringify(built, null, 2) + "\n", `${built.length} skills`);

  await mkdir(MARKETPLACE_DIR, { recursive: true });
  await writeIfChanged(
    MARKETPLACE_PATH,
    ".claude-plugin/marketplace.json",
    JSON.stringify(marketplace, null, 2) + "\n",
    `${marketplace.plugins.length} plugins`,
  );
}

await main();
