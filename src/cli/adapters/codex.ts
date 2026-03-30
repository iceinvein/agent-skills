import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Adapter } from "./claude";

export const codexAdapter: Adapter = {
  name: "codex",

  async install(cwd, manifest, files) {
    const installed: string[] = [];
    const config = manifest.install.codex;
    if (!config) return installed;

    // Codex does not support MCP
    if (config.mcpServers) {
      console.warn(`⚠ Codex does not support MCP servers — skipping MCP install for '${manifest.name}'`);
      return installed;
    }

    // Append prompt to AGENTS.md
    if (config.append && config.prompt && files.has(manifest.files?.prompt ?? "")) {
      const agentsPath = join(cwd, config.prompt);
      let existing = "";
      if (existsSync(agentsPath)) {
        existing = await Bun.file(agentsPath).text();
      }

      const content = files.get(manifest.files!.prompt!)!;
      const section = [
        `\n<!-- agent-skills:start:${manifest.name} -->`,
        content,
        `<!-- agent-skills:end:${manifest.name} -->\n`,
      ].join("\n");

      await Bun.write(agentsPath, existing + section);
      installed.push("AGENTS.md");
    }

    return installed;
  },

  async remove(cwd, manifest, _installedFiles) {
    const config = manifest.install.codex;
    if (!config) return;

    if (config.append && config.prompt) {
      const agentsPath = join(cwd, config.prompt);
      if (existsSync(agentsPath)) {
        const content = await Bun.file(agentsPath).text();
        const startMarker = `<!-- agent-skills:start:${manifest.name} -->`;
        const endMarker = `<!-- agent-skills:end:${manifest.name} -->`;
        const startIdx = content.indexOf(startMarker);
        const endIdx = content.indexOf(endMarker);

        if (startIdx !== -1 && endIdx !== -1) {
          const before = content.slice(0, startIdx).replace(/\n$/, "");
          const after = content.slice(endIdx + endMarker.length).replace(/^\n/, "");
          await Bun.write(agentsPath, before + after);
        }
      }
    }
  },
};
