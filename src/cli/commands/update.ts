// src/cli/commands/update.ts
import { readLockfile } from "../lockfile";
import { fetchSkillManifest, fetchAllSkillFiles } from "../github";
import { removeSkill } from "./remove";
import { installSkill } from "./install";
import type { ToolName } from "../types";

type UpdateResult =
  | { ok: true; from: string; to: string }
  | { ok: false; error: string };

export async function updateSkill(cwd: string, skillName: string): Promise<UpdateResult> {
  const lockfile = await readLockfile(cwd);
  const entry = lockfile.skills[skillName];

  if (!entry) {
    return { ok: false, error: `Skill '${skillName}' is not installed` };
  }

  const oldVersion = entry.version;
  const tools = entry.tools;

  // Fetch latest manifest
  const manifestResult = await fetchSkillManifest(skillName);
  if (!manifestResult.ok) {
    return { ok: false, error: manifestResult.error };
  }

  // Fetch latest files
  const filesResult = await fetchAllSkillFiles(skillName, manifestResult.manifest);
  if ("error" in filesResult) {
    return { ok: false, error: filesResult.error };
  }

  // Remove old installation
  await removeSkill(cwd, skillName);

  // Re-install with latest
  const installResult = await installSkill(cwd, manifestResult.manifest, filesResult, tools as ToolName[]);
  if (!installResult.ok) {
    return { ok: false, error: installResult.error };
  }

  return { ok: true, from: oldVersion, to: manifestResult.manifest.version };
}
