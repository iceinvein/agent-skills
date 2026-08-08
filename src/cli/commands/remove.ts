import { existsSync, statSync, unlinkSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { readLockfile, removeSkillFromLockfile } from "../lockfile";
import { fetchSkillManifest } from "../github";
import { getAdapter } from "../adapters";
import { unwireSessionStartHook } from "../adapters/claude";
import type { ToolName } from "../types";

type RemoveResult =
  | { ok: true; removed: string[]; warnings?: string[] }
  | { ok: false; error: string };

// Config files that hold settings shared across every skill installed for a
// tool: hooks, permissions, environment variables, MCP servers. The fallback
// removal path (used when the manifest cannot be fetched) must never delete
// these outright, since it has no way to know which entries inside them
// belong to this skill and which belong to something else entirely.
const SHARED_CONFIG_FILES = new Set([
  ".claude/settings.json",
  ".claude/settings.local.json",
  ".cursor/mcp.json",
  ".gemini/settings.json",
]);

function isSharedConfigFile(relPath: string): boolean {
  if (SHARED_CONFIG_FILES.has(relPath)) return true;
  // Generic guard for shapes not enumerated above: a settings/mcp config file
  // living directly under a tool's dotfolder (".claude/settings.json",
  // ".codex/mcp.json", and so on) is shared across skills, not skill-owned.
  const parts = relPath.split("/");
  const name = basename(relPath);
  const isConfigName = name === "settings.json" || name === "settings.local.json" || name === "mcp.json";
  return parts.length === 2 && parts[0].startsWith(".") && isConfigName;
}

function removeFileOrDir(fullPath: string): void {
  const stat = statSync(fullPath);
  if (stat.isDirectory()) {
    rmSync(fullPath, { recursive: true, force: true });
  } else {
    unlinkSync(fullPath);
  }
}

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

    await removeSkillFromLockfile(cwd, skillName);
    return { ok: true, removed: entry.files };
  }

  // Fallback: the manifest could not be fetched (offline, or the skill was
  // never published to the GitHub master branch). Without it we cannot tell
  // which mcpServers keys inside a shared config file belong to this skill,
  // so those files are never deleted and their mcpServers entries are left
  // alone. The skill's own SessionStart hook is still keyed by name (see
  // matchesSkillDirective in ../adapters/claude), so it can be stripped out
  // safely even without the manifest. Everything else genuinely owned by the
  // skill (its prompt file, its bundle directory) is still removed.
  const removed: string[] = [];
  const warnings: string[] = [];

  for (const file of entry.files) {
    if (isSharedConfigFile(file)) {
      const fullPath = join(cwd, file);
      if (existsSync(fullPath)) {
        await unwireSessionStartHook(fullPath, skillName);
      }
      warnings.push(
        `Manifest unavailable (${manifestResult.error}). Left '${file}' in place, only removing '${skillName}'s SessionStart hook from it; any MCP server entries it owns were not touched.`
      );
      continue;
    }

    const fullPath = join(cwd, file);
    if (!existsSync(fullPath)) continue;
    removeFileOrDir(fullPath);
    removed.push(file);
  }

  await removeSkillFromLockfile(cwd, skillName);
  return { ok: true, removed, ...(warnings.length > 0 ? { warnings } : {}) };
}
