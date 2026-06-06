#!/usr/bin/env bun
// One-shot skill audit. Read-only: checks invariants across skill dirs, skill.json,
// SKILL.md frontmatter, index.json, and README. Prints a report; writes nothing.

import { readdir } from "node:fs/promises";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SKILLS = join(ROOT, "skills");
const INDEX = join(SKILLS, "index.json");
const README = join(ROOT, "README.md");

type Issue = { sev: "ERR" | "WARN" | "INFO"; skill: string; msg: string };
const issues: Issue[] = [];
const add = (sev: Issue["sev"], skill: string, msg: string) => issues.push({ sev, skill, msg });

function parseFrontmatter(text: string): { name?: string; description?: string; raw?: string } | null {
  if (!text.startsWith("---")) return null;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return null;
  const raw = text.slice(3, end).trim();
  const out: Record<string, string> = {};
  // naive YAML: key: value (single line). description may be folded but skills here are single-line.
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return { name: out.name, description: out.description, raw };
}

const dirs = (await readdir(SKILLS, { withFileTypes: true }))
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

const indexArr: any[] = await Bun.file(INDEX).json();
const indexByName = new Map(indexArr.map((e) => [e.name, e]));
const readmeText = await Bun.file(README).text();

type Rec = {
  dir: string;
  hasSkillJson: boolean;
  hasSkillMd: boolean;
  json?: any;
  fm?: { name?: string; description?: string };
  inIndex: boolean;
  inReadme: boolean;
};
const recs: Rec[] = [];

for (const dir of dirs) {
  const sjPath = join(SKILLS, dir, "skill.json");
  const mdPath = join(SKILLS, dir, "SKILL.md");
  const sjFile = Bun.file(sjPath);
  const mdFile = Bun.file(mdPath);
  const hasSkillJson = await sjFile.exists();
  const hasSkillMd = await mdFile.exists();

  let json: any;
  if (hasSkillJson) {
    try {
      json = await sjFile.json();
    } catch (e) {
      add("ERR", dir, `skill.json is invalid JSON: ${(e as Error).message}`);
    }
  }
  let fm: { name?: string; description?: string } | undefined;
  if (hasSkillMd) {
    const text = await mdFile.text();
    const p = parseFrontmatter(text);
    if (!p) add("ERR", dir, "SKILL.md missing/invalid YAML frontmatter");
    else {
      fm = p;
      if (p.raw && p.raw.length > 1024) add("WARN", dir, `frontmatter ${p.raw.length} chars (>1024 limit)`);
      if (!p.name) add("ERR", dir, "SKILL.md frontmatter missing 'name'");
      if (!p.description) add("ERR", dir, "SKILL.md frontmatter missing 'description'");
      if (p.name && !/^[A-Za-z0-9-]+$/.test(p.name)) add("ERR", dir, `name '${p.name}' has illegal chars`);
    }
  }

  const rec: Rec = {
    dir,
    hasSkillJson,
    hasSkillMd,
    json,
    fm,
    inIndex: indexByName.has(json?.name ?? dir),
    inReadme: new RegExp(`\\*\\*${dir}\\*\\*|\`${dir}\``).test(readmeText) || readmeText.includes(dir),
  };
  recs.push(rec);
}

for (const r of recs) {
  // A dir with neither manifest nor prompt is not a skill (scratch/workspace clutter).
  // skills/ should contain only skills, so surface it but don't treat it as a broken skill.
  if (!r.hasSkillJson && !r.hasSkillMd) {
    add("INFO", r.dir, "stray non-skill dir in skills/ (no SKILL.md or skill.json; relocate or gitignore)");
    continue;
  }

  // A real skill dir must have BOTH files. Exactly one present = broken skill.
  if (!r.hasSkillMd) add("ERR", r.dir, "has skill.json but no SKILL.md");
  if (!r.hasSkillJson) add("ERR", r.dir, "has SKILL.md but no skill.json -> invisible to CLI/index");

  // dir name vs skill.json.name vs frontmatter name.
  // The SKILL.md `name` is what the agent registers the skill under; a mismatch
  // means the skill installs under one dir but registers under another name.
  if (r.json && r.json.name !== r.dir) add("ERR", r.dir, `skill.json name '${r.json.name}' != dir`);
  if (r.fm?.name && r.fm.name !== r.dir) add("ERR", r.dir, `SKILL.md frontmatter name '${r.fm.name}' != dir (skill registers under wrong name)`);

  // index staleness only. skill.json/index = catalog blurb; SKILL.md frontmatter =
  // "Use when..." triggering description. Those two ARE meant to differ (two-tier), so
  // don't compare them.
  const sjDesc = r.json?.description?.trim();
  const idxDesc = indexByName.get(r.json?.name ?? r.dir)?.description?.trim();
  if (r.json?.name && indexByName.has(r.json.name) && sjDesc && idxDesc && sjDesc !== idxDesc)
    add("ERR", r.dir, "description differs: skill.json vs index.json (index stale)");

  // version present
  if (r.json && !r.json.version) add("ERR", r.dir, "skill.json missing version");

  // index sync
  if (r.hasSkillJson && !r.inIndex) add("ERR", r.dir, "has skill.json but NOT in index.json (run build:index)");

  // README coverage
  if (r.hasSkillJson && !r.inReadme) add("WARN", r.dir, "not mentioned in README");

  // emdash in description (user style rule)
  if (sjDesc?.includes("—")) add("INFO", r.dir, "description contains emdash (—)");
}

// orphans: index entries with no dir
for (const e of indexArr) {
  if (!dirs.includes(e.name)) add("ERR", e.name, "in index.json but no matching skill dir");
}

// dirs with skill.json but README documents them or not — already covered.

// ---- report ----
const order = { ERR: 0, WARN: 1, INFO: 2 } as const;
issues.sort((a, b) => order[a.sev] - order[b.sev] || a.skill.localeCompare(b.skill));
const counts = { ERR: 0, WARN: 0, INFO: 0 };
for (const i of issues) counts[i.sev]++;

console.log(`\n=== SKILL AUDIT ===`);
console.log(`skill dirs: ${dirs.length}  |  index entries: ${indexArr.length}  |  with skill.json: ${recs.filter((r) => r.hasSkillJson).length}`);
console.log(`findings: ${counts.ERR} ERR, ${counts.WARN} WARN, ${counts.INFO} INFO\n`);
for (const i of issues) console.log(`[${i.sev}] ${i.skill}: ${i.msg}`);

// version table
console.log(`\n=== versions ===`);
for (const r of recs.filter((r) => r.json)) console.log(`${r.json.version.padEnd(8)} ${r.dir}`);
