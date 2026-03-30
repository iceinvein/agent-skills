import { existsSync, mkdirSync, rmSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import type { SkillManifest } from "../types";
import { readJsonFile, writeFile } from "../fs";

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
      await writeFile(targetPath, files.get(manifest.files!.prompt!)!);
      installed.push(config.prompt);
    }

    // Install supporting files
    if (config.supporting) {
      for (const [sourceFile, targetRel] of Object.entries(config.supporting)) {
        if (files.has(sourceFile)) {
          const targetPath = join(cwd, targetRel);
          mkdirSync(dirname(targetPath), { recursive: true });
          await writeFile(targetPath, files.get(sourceFile)!);
          installed.push(targetRel);
        }
      }
    }

    // Install MCP servers
    if (config.mcpServers) {
      const settingsPath = join(cwd, ".claude/settings.json");
      let settings: Record<string, any> = {};
      if (existsSync(settingsPath)) {
        settings = await readJsonFile<Record<string, any>>(settingsPath);
      }
      if (!settings.mcpServers) settings.mcpServers = {};

      for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
        settings.mcpServers[name] = serverConfig;
      }

      await writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n");
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
        const settings = await readJsonFile<Record<string, any>>(settingsPath);
        if (settings.mcpServers) {
          for (const name of Object.keys(config.mcpServers)) {
            delete settings.mcpServers[name];
          }
          await writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n");
        }
      }
    }
  },
};
