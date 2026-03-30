// src/cli/commands/install.ts
import type { SkillManifest, ToolName } from "../types";
import { getAdapter } from "../adapters";
import { addSkillToLockfile } from "../lockfile";

type InstallResult =
  | { ok: true; installed: Record<string, string[]>; skipped: string[] }
  | { ok: false; error: string };

export async function installSkill(
  cwd: string,
  manifest: SkillManifest,
  files: Map<string, string>,
  targetTools: ToolName[]
): Promise<InstallResult> {
  const compatibleTools = targetTools.filter((t) => manifest.tools.includes(t));
  const skipped = targetTools.filter((t) => !manifest.tools.includes(t));

  if (compatibleTools.length === 0) {
    return {
      ok: false,
      error: `Skill '${manifest.name}' does not support any of: ${targetTools.join(", ")}. Supported: ${manifest.tools.join(", ")}`,
    };
  }

  const installed: Record<string, string[]> = {};
  const allFiles: string[] = [];

  for (const tool of compatibleTools) {
    const adapter = getAdapter(tool);
    const toolFiles = await adapter.install(cwd, manifest, files);
    installed[tool] = toolFiles;
    allFiles.push(...toolFiles);
  }

  await addSkillToLockfile(cwd, manifest.name, {
    version: manifest.version,
    tools: compatibleTools,
    installedAt: new Date().toISOString(),
    files: allFiles,
  });

  return { ok: true, installed, skipped };
}
