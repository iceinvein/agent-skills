// src/cli/commands/bump.ts
import { join } from "node:path";
import { bumpVersion, type BumpLevel } from "../semver";

type BumpResult =
  | { ok: true; from: string; to: string }
  | { ok: false; error: string };

export async function bumpSkill(
  repoRoot: string,
  skillName: string,
  level: BumpLevel
): Promise<BumpResult> {
  const manifestPath = join(repoRoot, "skills", skillName, "skill.json");
  const file = Bun.file(manifestPath);

  if (!(await file.exists())) {
    return { ok: false, error: `Skill '${skillName}' not found at skills/${skillName}/skill.json` };
  }

  const manifest = await file.json();
  const from = manifest.version;

  let to: string;
  try {
    to = bumpVersion(from, level);
  } catch (e) {
    return { ok: false, error: `Invalid version '${from}' in skills/${skillName}/skill.json` };
  }

  manifest.version = to;
  await Bun.write(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  return { ok: true, from, to };
}

type BumpAllResult = Array<
  | { name: string; ok: true; from: string; to: string }
  | { name: string; ok: false; error: string }
>;

function getLatestTag(repoRoot: string): string | null {
  const result = Bun.spawnSync(["git", "describe", "--tags", "--abbrev=0"], {
    cwd: repoRoot,
  });
  if (result.exitCode !== 0) return null;
  return result.stdout.toString().trim();
}

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

function getChangedSkills(repoRoot: string, sinceTag: string | null): Set<string> {
  const base = sinceTag ?? EMPTY_TREE;
  const args = ["git", "diff", "--name-only", base, "HEAD", "--", "skills/"];

  const result = Bun.spawnSync(args, { cwd: repoRoot });
  const output = result.stdout.toString().trim();
  if (!output) return new Set();

  const names = new Set<string>();
  for (const line of output.split("\n")) {
    const parts = line.split("/");
    if (parts.length >= 2 && parts[0] === "skills") {
      names.add(parts[1]);
    }
  }
  return names;
}

function skillVersionChanged(repoRoot: string, skillName: string, sinceTag: string | null): boolean {
  const base = sinceTag ?? EMPTY_TREE;
  const args = ["git", "diff", base, "HEAD", "--", `skills/${skillName}/skill.json`];

  const result = Bun.spawnSync(args, { cwd: repoRoot });
  const diff = result.stdout.toString();

  // A version bump is indicated by both a removed and an added "version" line.
  // A newly-created file only has added lines, which should not be treated as a bump.
  const hasRemoved = diff.split("\n").some((l) => l.startsWith("-") && !l.startsWith("---") && l.includes('"version"'));
  const hasAdded = diff.split("\n").some((l) => l.startsWith("+") && !l.startsWith("+++") && l.includes('"version"'));
  return hasRemoved && hasAdded;
}

export async function bumpAllChanged(
  repoRoot: string,
  level: BumpLevel,
  dryRun: boolean
): Promise<BumpAllResult> {
  const tag = getLatestTag(repoRoot);
  const changed = getChangedSkills(repoRoot, tag);
  const results: BumpAllResult = [];

  for (const skillName of changed) {
    if (skillVersionChanged(repoRoot, skillName, tag)) continue;

    if (dryRun) {
      const manifestPath = join(repoRoot, "skills", skillName, "skill.json");
      const file = Bun.file(manifestPath);
      if (!(await file.exists())) continue;
      const manifest = await file.json();
      const from = manifest.version;
      try {
        const to = bumpVersion(from, level);
        results.push({ name: skillName, ok: true, from, to });
      } catch {
        results.push({ name: skillName, ok: false, error: `Invalid version '${from}'` });
      }
    } else {
      const result = await bumpSkill(repoRoot, skillName, level);
      results.push({ name: skillName, ...result });
    }
  }

  return results;
}
