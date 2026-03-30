const REPO = "iceinvein/agent-skills";
const BRANCH = "master";
const INDEX_URL = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/skills/index.json`;

export type SkillSummary = {
  name: string;
  description: string;
  type: string;
  version: string;
};

type ListResult =
  | { ok: true; skills: SkillSummary[] }
  | { ok: false; error: string };

export async function listSkills(): Promise<ListResult> {
  const res = await fetch(INDEX_URL);
  if (!res.ok) {
    return { ok: false, error: `Failed to fetch skill index: HTTP ${res.status}` };
  }
  const skills: SkillSummary[] = await res.json();
  return { ok: true, skills };
}
