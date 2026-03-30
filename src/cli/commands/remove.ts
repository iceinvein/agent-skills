import { readLockfile, removeSkillFromLockfile } from "../lockfile";
import { fetchSkillManifest } from "../github";
import { getAdapter } from "../adapters";
import type { ToolName } from "../types";

type RemoveResult =
  | { ok: true; removed: string[] }
  | { ok: false; error: string };

export async function removeSkill(cwd: string, skillName: string): Promise<RemoveResult> {
  const lockfile = await readLockfile(cwd);
  const entry = lockfile.skills[skillName];

  if (!entry) {
    return { ok: false, error: `Skill '${skillName}' is not installed` };
  }

  // Fetch manifest to know how to clean up (MCP entries, etc.)
  const manifestResult = await fetchSkillManifest(skillName);

  if (manifestResult.ok) {
    // Use adapters for clean removal
    for (const tool of entry.tools) {
      const adapter = getAdapter(tool as ToolName);
      const toolFiles = entry.files.filter((f) => {
        const config = manifestResult.manifest.install[tool as ToolName];
        if (!config) return false;
        if (config.prompt && f === config.prompt) return true;
        if (config.supporting && Object.values(config.supporting).includes(f)) return true;
        if (config.mcpServers && (f.includes(".claude/settings") || f.includes(".cursor/mcp") || f.includes(".gemini/settings"))) return true;
        return false;
      });
      await adapter.remove(cwd, manifestResult.manifest, toolFiles);
    }
  } else {
    // Fallback: delete files listed in lockfile directly
    const { unlinkSync, existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    for (const file of entry.files) {
      const fullPath = join(cwd, file);
      if (existsSync(fullPath)) {
        unlinkSync(fullPath);
      }
    }
  }

  await removeSkillFromLockfile(cwd, skillName);
  return { ok: true, removed: entry.files };
}
