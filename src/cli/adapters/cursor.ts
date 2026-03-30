import { existsSync, mkdirSync, unlinkSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Adapter } from "./claude";
import { readJsonFile, writeFile } from "../fs";

export const cursorAdapter: Adapter = {
  name: "cursor",

  async install(cwd, manifest, files) {
    const installed: string[] = [];
    const config = manifest.install.cursor;
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
      const mcpPath = join(cwd, ".cursor/mcp.json");
      let mcpConfig: Record<string, any> = {};
      if (existsSync(mcpPath)) {
        mcpConfig = await readJsonFile<Record<string, any>>(mcpPath);
      }
      if (!mcpConfig.mcpServers) mcpConfig.mcpServers = {};

      for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
        mcpConfig.mcpServers[name] = serverConfig;
      }

      await writeFile(mcpPath, JSON.stringify(mcpConfig, null, 2) + "\n");
      installed.push(".cursor/mcp.json");
    }

    return installed;
  },

  async remove(cwd, manifest, installedFiles) {
    const config = manifest.install.cursor;
    if (!config) return;

    for (const file of installedFiles) {
      if (file === ".cursor/mcp.json") continue;
      const fullPath = join(cwd, file);
      if (existsSync(fullPath)) {
        unlinkSync(fullPath);
        try { rmSync(dirname(fullPath), { recursive: false }); } catch {}
      }
    }

    if (config.mcpServers) {
      const mcpPath = join(cwd, ".cursor/mcp.json");
      if (existsSync(mcpPath)) {
        const mcpConfig = await readJsonFile<Record<string, any>>(mcpPath);
        if (mcpConfig.mcpServers) {
          for (const name of Object.keys(config.mcpServers)) {
            delete mcpConfig.mcpServers[name];
          }
          await writeFile(mcpPath, JSON.stringify(mcpConfig, null, 2) + "\n");
        }
      }
    }
  },
};
