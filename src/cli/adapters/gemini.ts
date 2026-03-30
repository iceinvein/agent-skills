import { existsSync, mkdirSync, unlinkSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Adapter } from "./claude";
import { readJsonFile, writeFile } from "../fs";

export const geminiAdapter: Adapter = {
  name: "gemini",

  async install(cwd, manifest, files) {
    const installed: string[] = [];
    const config = manifest.install.gemini;
    if (!config) return installed;

    if (config.prompt && files.has(manifest.files?.prompt ?? "")) {
      const targetPath = join(cwd, config.prompt);
      mkdirSync(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, files.get(manifest.files!.prompt!)!);
      installed.push(config.prompt);
    }

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

    if (config.mcpServers) {
      const settingsPath = join(cwd, ".gemini/settings.json");
      let settings: Record<string, any> = {};
      if (existsSync(settingsPath)) {
        settings = await readJsonFile<Record<string, any>>(settingsPath);
      }
      if (!settings.mcpServers) settings.mcpServers = {};

      for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
        settings.mcpServers[name] = serverConfig;
      }

      await writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n");
      installed.push(".gemini/settings.json");
    }

    return installed;
  },

  async remove(cwd, manifest, installedFiles) {
    const config = manifest.install.gemini;
    if (!config) return;

    for (const file of installedFiles) {
      if (file === ".gemini/settings.json") continue;
      const fullPath = join(cwd, file);
      if (existsSync(fullPath)) {
        unlinkSync(fullPath);
        try { rmSync(dirname(fullPath), { recursive: false }); } catch {}
      }
    }

    if (config.mcpServers) {
      const settingsPath = join(cwd, ".gemini/settings.json");
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
