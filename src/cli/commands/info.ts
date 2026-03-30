import { fetchSkillManifest } from "../github";
import type { SkillManifest } from "../types";

type InfoResult =
  | { ok: true; manifest: SkillManifest }
  | { ok: false; error: string };

export async function infoSkill(skillName: string): Promise<InfoResult> {
  return fetchSkillManifest(skillName);
}
