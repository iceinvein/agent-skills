import { input, checkbox } from "@inquirer/prompts";
import type { SkillSummary } from "./commands/list";

const TYPE_TAGS: Record<string, string> = {
  prompt: "📝",
  code: "⚙️",
  hybrid: "🔀",
};

export function filterSkills(skills: SkillSummary[], query: string): SkillSummary[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return skills;
  return skills.filter(
    (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
  );
}

export function formatChoice(skill: SkillSummary): { name: string; value: string; description: string } {
  const tag = TYPE_TAGS[skill.type] ?? "•";
  return {
    name: `${tag}  ${skill.name.padEnd(34)} v${skill.version}`,
    value: skill.name,
    description: skill.description,
  };
}

type BrowseSelection = {
  picked: string[];
  query: string;
};

export async function browseAndSelect(skills: SkillSummary[]): Promise<BrowseSelection> {
  const query = await input({
    message: "Filter skills (substring; blank = all):",
    default: "",
  });

  const filtered = filterSkills(skills, query);
  if (filtered.length === 0) {
    console.log(`\nNo skills matched "${query}".`);
    return { picked: [], query };
  }

  const picked = await checkbox<string>({
    message: `Select skills to install (${filtered.length} match${filtered.length === 1 ? "" : "es"}):`,
    choices: filtered.map(formatChoice),
    pageSize: 15,
    loop: false,
  });

  return { picked, query };
}
