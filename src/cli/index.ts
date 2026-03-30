#!/usr/bin/env bun
import { detectTools } from "./detect";
import { fetchSkillManifest, fetchAllSkillFiles } from "./github";
import { installSkill } from "./commands/install";
import { removeSkill } from "./commands/remove";
import { listSkills } from "./commands/list";
import { infoSkill } from "./commands/info";
import { updateSkill } from "./commands/update";
import { TOOL_NAMES, type ToolName } from "./types";
import { promptSelect } from "./prompt";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

type ParsedArgs = {
  command: string;
  args: string[];
  flags: Record<string, string>;
};

export function parseArgs(argv: string[]): ParsedArgs {
  if (argv.length === 0) return { command: "help", args: [], flags: {} };

  const command = argv[0];
  const args: string[] = [];
  const flags: Record<string, string> = {};

  for (let i = 1; i < argv.length; i++) {
    if (argv[i].startsWith("--") && i + 1 < argv.length) {
      flags[argv[i].slice(2)] = argv[i + 1];
      i++;
    } else {
      args.push(argv[i]);
    }
  }

  return { command, args, flags };
}

function printHelp() {
  console.log(`
@iceinvein/agent-skills — Install agent skills into AI coding tools

Usage:
  agent-skills install <skill>  [--tool <tool>]   Install a skill
  agent-skills remove  <skill>                     Remove a skill
  agent-skills update  <skill>                     Update a skill
  agent-skills list                                List available skills
  agent-skills info    <skill>                     Show skill details

Tools: ${TOOL_NAMES.join(", ")}

If --tool is omitted, auto-detects tools in the current directory.
`);
}

function printInstalled(result: Record<string, string[]>, skipped: string[]) {
  for (const [tool, files] of Object.entries(result)) {
    console.log(`  ✓ ${tool}`);
    for (const file of files) {
      console.log(`    → ${file}`);
    }
  }
  for (const tool of skipped) {
    console.log(`  ⊘ ${tool} (skill does not support this tool)`);
  }
}

async function main() {
  const { command, args, flags } = parseArgs(process.argv.slice(2));

  switch (command) {
    case "install": {
      const skillName = args[0];
      if (!skillName) {
        console.error("Error: skill name required. Usage: agent-skills install <skill>");
        process.exit(1);
      }

      console.log(`Fetching skill '${skillName}'...`);
      const manifestResult = await fetchSkillManifest(skillName);
      if (!manifestResult.ok) {
        console.error(`Error: ${manifestResult.error}`);
        process.exit(1);
      }

      const filesResult = await fetchAllSkillFiles(skillName, manifestResult.manifest);
      if ("error" in filesResult) {
        console.error(`Error: ${filesResult.error}`);
        process.exit(1);
      }

      let tools: ToolName[];
      if (flags.tool) {
        if (!TOOL_NAMES.includes(flags.tool as ToolName)) {
          console.error(`Error: unknown tool '${flags.tool}'. Must be one of: ${TOOL_NAMES.join(", ")}`);
          process.exit(1);
        }
        tools = [flags.tool as ToolName];
      } else {
        tools = await detectTools(process.cwd());
        if (tools.length === 0) {
          // Filter to only tools the skill supports
          const supportedTools = manifestResult.manifest.tools;
          const selected = await promptSelect(
            "No tools detected in this directory. Which tools do you use?",
            supportedTools.map((t) => ({
              label: { claude: "Claude Code", cursor: "Cursor", codex: "Codex", gemini: "Gemini CLI" }[t],
              value: t,
            }))
          );
          tools = selected as ToolName[];

          // Create tool directories so future runs auto-detect
          for (const tool of tools) {
            const dirs: Record<string, string> = {
              claude: ".claude",
              cursor: ".cursor",
              gemini: ".gemini",
            };
            if (dirs[tool]) {
              mkdirSync(join(process.cwd(), dirs[tool]), { recursive: true });
            }
          }
        } else {
          console.log(`Detected tools: ${tools.join(", ")}`);
        }
      }

      const result = await installSkill(process.cwd(), manifestResult.manifest, filesResult, tools);
      if (!result.ok) {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }

      console.log(`\n✓ Installed '${skillName}' v${manifestResult.manifest.version}:`);
      printInstalled(result.installed, result.skipped);
      break;
    }

    case "remove": {
      const skillName = args[0];
      if (!skillName) {
        console.error("Error: skill name required. Usage: agent-skills remove <skill>");
        process.exit(1);
      }

      const result = await removeSkill(process.cwd(), skillName);
      if (!result.ok) {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }

      console.log(`✓ Removed '${skillName}'`);
      break;
    }

    case "update": {
      const skillName = args[0];
      if (!skillName) {
        console.error("Error: skill name required. Usage: agent-skills update <skill>");
        process.exit(1);
      }

      console.log(`Updating '${skillName}'...`);
      const result = await updateSkill(process.cwd(), skillName);
      if (!result.ok) {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }

      console.log(`✓ Updated '${skillName}' from v${result.from} to v${result.to}`);
      break;
    }

    case "list": {
      console.log("Fetching available skills...\n");
      const result = await listSkills();
      if (!result.ok) {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }

      for (const skill of result.skills) {
        const typeTag = skill.type === "prompt" ? "📝" : skill.type === "code" ? "⚙️" : "🔀";
        console.log(`  ${typeTag} ${skill.name} (v${skill.version})`);
        console.log(`    ${skill.description}\n`);
      }
      break;
    }

    case "info": {
      const skillName = args[0];
      if (!skillName) {
        console.error("Error: skill name required. Usage: agent-skills info <skill>");
        process.exit(1);
      }

      const result = await infoSkill(skillName);
      if (!result.ok) {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }

      const m = result.manifest;
      console.log(`\n${m.name} v${m.version}`);
      console.log(`  ${m.description}`);
      console.log(`  Author: ${m.author}`);
      console.log(`  Type:   ${m.type}`);
      console.log(`  Tools:  ${m.tools.join(", ")}`);
      if (m.mcp) console.log(`  Package: ${m.mcp.package}`);
      break;
    }

    case "help":
    default:
      printHelp();
      break;
  }
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
