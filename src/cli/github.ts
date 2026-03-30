import { validateManifest, type SkillManifest } from "./types";

const REPO = "iceinvein/agent-skills";
const BRANCH = "master";
const BASE = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`;

export function buildRawUrl(skillName: string, filePath: string): string {
  return `${BASE}/skills/${skillName}/${filePath}`;
}

type FetchManifestResult =
  | { ok: true; manifest: SkillManifest }
  | { ok: false; error: string };

export async function fetchSkillManifest(skillName: string): Promise<FetchManifestResult> {
  const url = buildRawUrl(skillName, "skill.json");
  const res = await fetch(url);

  if (res.status === 404) {
    return { ok: false, error: `Skill '${skillName}' not found` };
  }
  if (!res.ok) {
    return { ok: false, error: `Failed to fetch manifest: HTTP ${res.status}` };
  }

  const data = await res.json();
  return validateManifest(data);
}

type FetchFileResult =
  | { ok: true; content: string }
  | { ok: false; error: string };

export async function fetchSkillFile(skillName: string, filePath: string): Promise<FetchFileResult> {
  const url = buildRawUrl(skillName, filePath);
  const res = await fetch(url);

  if (!res.ok) {
    return { ok: false, error: `Failed to fetch '${filePath}': HTTP ${res.status}` };
  }

  const content = await res.text();
  return { ok: true, content };
}

export async function fetchAllSkillFiles(
  skillName: string,
  manifest: SkillManifest
): Promise<Map<string, string> | { error: string }> {
  const files = new Map<string, string>();

  if (manifest.files?.prompt) {
    const result = await fetchSkillFile(skillName, manifest.files.prompt);
    if (!result.ok) return { error: result.error };
    files.set(manifest.files.prompt, result.content);
  }

  if (manifest.files?.supporting) {
    for (const supportFile of manifest.files.supporting) {
      const result = await fetchSkillFile(skillName, supportFile);
      if (!result.ok) return { error: result.error };
      files.set(supportFile, result.content);
    }
  }

  return files;
}
