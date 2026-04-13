import { existsSync, mkdirSync, rmSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import type { SkillManifest } from "../types";

type HookEntry = { type: "command"; command: string };
type HookGroup = { hooks: HookEntry[] };
type Settings = Record<string, any>;

function matchesSkillDirective(command: string, skillName: string): boolean {
  return command.includes(`Activate ${skillName} skill`);
}

export async function wireSessionStartHook(
  settingsPath: string,
  skillName: string,
  directive: string
): Promise<void> {
  let settings: Settings = {};
  if (existsSync(settingsPath)) {
    settings = await Bun.file(settingsPath).json();
  }
  if (!settings.hooks) settings.hooks = {};
  if (!settings.hooks.SessionStart) settings.hooks.SessionStart = [];

  const command = `echo '${directive}'`;

  // Idempotency: skip if any existing entry already matches this skill
  for (const group of settings.hooks.SessionStart as HookGroup[]) {
    for (const hook of group.hooks ?? []) {
      if (matchesSkillDirective(hook.command, skillName)) return;
    }
  }

  settings.hooks.SessionStart.push({
    hooks: [{ type: "command", command }],
  });

  mkdirSync(dirname(settingsPath), { recursive: true });
  await Bun.write(settingsPath, JSON.stringify(settings, null, 2) + "\n");
}

export async function unwireSessionStartHook(
  settingsPath: string,
  skillName: string
): Promise<void> {
  if (!existsSync(settingsPath)) return;

  const settings: Settings = await Bun.file(settingsPath).json();
  const sessionStart = settings.hooks?.SessionStart as HookGroup[] | undefined;
  if (!sessionStart) return;

  const filteredGroups = sessionStart
    .map((group) => ({
      hooks: (group.hooks ?? []).filter((h) => !matchesSkillDirective(h.command, skillName)),
    }))
    .filter((group) => group.hooks.length > 0);

  if (filteredGroups.length === 0) {
    delete settings.hooks.SessionStart;
  } else {
    settings.hooks.SessionStart = filteredGroups;
  }

  if (settings.hooks && Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  await Bun.write(settingsPath, JSON.stringify(settings, null, 2) + "\n");
}

export type Adapter = {
  name: string;
  install(cwd: string, manifest: SkillManifest, files: Map<string, string>): Promise<string[]>;
  remove(cwd: string, manifest: SkillManifest, installedFiles: string[]): Promise<void>;
};

export const claudeAdapter: Adapter = {
  name: "claude",

  async install(cwd, manifest, files) {
    const installed: string[] = [];
    const config = manifest.install.claude;
    if (!config) return installed;

    // Install prompt file
    if (config.prompt && files.has(manifest.files?.prompt ?? "")) {
      const targetPath = join(cwd, config.prompt);
      mkdirSync(dirname(targetPath), { recursive: true });
      await Bun.write(targetPath, files.get(manifest.files!.prompt!)!);
      installed.push(config.prompt);
    }

    // Install supporting files
    if (config.supporting) {
      for (const [sourceFile, targetRel] of Object.entries(config.supporting)) {
        if (files.has(sourceFile)) {
          const targetPath = join(cwd, targetRel);
          mkdirSync(dirname(targetPath), { recursive: true });
          await Bun.write(targetPath, files.get(sourceFile)!);
          installed.push(targetRel);
        }
      }
    }

    // Install MCP servers
    if (config.mcpServers) {
      const settingsPath = join(cwd, ".claude/settings.json");
      let settings: Record<string, any> = {};
      if (existsSync(settingsPath)) {
        settings = await Bun.file(settingsPath).json();
      }
      if (!settings.mcpServers) settings.mcpServers = {};

      for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
        settings.mcpServers[name] = serverConfig;
      }

      await Bun.write(settingsPath, JSON.stringify(settings, null, 2) + "\n");
      installed.push(".claude/settings.json");
    }

    return installed;
  },

  async remove(cwd, manifest, installedFiles) {
    const config = manifest.install.claude;
    if (!config) return;

    // Remove prompt and supporting files
    for (const file of installedFiles) {
      if (file === ".claude/settings.json") continue;
      const fullPath = join(cwd, file);
      if (existsSync(fullPath)) {
        unlinkSync(fullPath);
        // Clean up empty parent directories
        const dir = dirname(fullPath);
        try { rmSync(dir, { recursive: false }); } catch {}
      }
    }

    // Remove MCP server entries
    if (config.mcpServers) {
      const settingsPath = join(cwd, ".claude/settings.json");
      if (existsSync(settingsPath)) {
        const settings = await Bun.file(settingsPath).json();
        if (settings.mcpServers) {
          for (const name of Object.keys(config.mcpServers)) {
            delete settings.mcpServers[name];
          }
          await Bun.write(settingsPath, JSON.stringify(settings, null, 2) + "\n");
        }
      }
    }
  },
};
