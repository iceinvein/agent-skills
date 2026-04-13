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
