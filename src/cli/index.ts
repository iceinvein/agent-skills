#!/usr/bin/env bun
import { detectTools } from "./detect";
import { fetchSkillManifest, fetchAllSkillFiles } from "./github";
import { installSkill } from "./commands/install";
import { removeSkill } from "./commands/remove";
import { listSkills } from "./commands/list";
import { infoSkill } from "./commands/info";
import { updateSkill, updateAllSkills } from "./commands/update";
import { checkForUpdates } from "./update-check";
import { TOOL_NAMES, type ToolName } from "./types";
import { promptSelect } from "./prompt";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

function resolveInstallDir(flags: Record<string, string>): string {
  if (flags.global !== undefined || flags.g !== undefined) {
    return homedir();
  }
  return process.cwd();
}

type ParsedArgs = {
  command: string;
  args: string[];
  flags: Record<string, string>;
};

const BOOLEAN_FLAGS = new Set(["global", "g", "all"]);

export function parseArgs(argv: string[]): ParsedArgs {
  if (argv.length === 0) return { command: "help", args: [], flags: {} };

  const command = argv[0];
  const args: string[] = [];
  const flags: Record<string, string> = {};

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-g") {
      flags.global = "true";
    } else if (arg.startsWith("--")) {
      const key = arg.slice(2);
      if (BOOLEAN_FLAGS.has(key)) {
        flags[key] = "true";
      } else if (i + 1 < argv.length) {
        flags[key] = argv[i + 1];
        i++;
      }
    } else {
      args.push(arg);
    }
  }

  return { command, args, flags };
}

function printHelp() {
  console.log(`
@iceinvein/agent-skills — Install agent skills into AI coding tools

Usage:
  agent-skills install <skill>  [--tool <tool>] [-g]  Install a skill
  agent-skills remove  <skill>  [-g]                   Remove a skill
  agent-skills update  <skill>  [-g]                   Update a skill
  agent-skills update  --all    [-g]                   Update all installed skills
  agent-skills list                                    List available skills
  agent-skills info    <skill>                         Show skill details

Flags:
  --tool <tool>   Install for a specific tool (${TOOL_NAMES.join(", ")})
  -g, --global    Install to home directory (available in all projects)
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

      const installDir = resolveInstallDir(flags);
      const isGlobal = installDir === homedir();
      if (isGlobal) console.log(`Installing globally to ${installDir}`);

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
        tools = await detectTools(installDir);
        if (tools.length === 0) {
          // Filter to only tools the skill supports
          const supportedTools = manifestResult.manifest.tools;
          const selected = await promptSelect(
            isGlobal
              ? "Which tools do you use?"
              : "No tools detected in this directory. Which tools do you use?",
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
              mkdirSync(join(installDir, dirs[tool]), { recursive: true });
            }
          }
        } else {
          console.log(`Detected tools: ${tools.join(", ")}`);
        }
      }

      const result = await installSkill(installDir, manifestResult.manifest, filesResult, tools);
      if (!result.ok) {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }

      console.log(`\n✓ Installed '${skillName}' v${manifestResult.manifest.version}${isGlobal ? " (global)" : ""}:`);
      printInstalled(result.installed, result.skipped);
      break;
    }

    case "remove": {
      const skillName = args[0];
      if (!skillName) {
        console.error("Error: skill name required. Usage: agent-skills remove <skill>");
        process.exit(1);
      }

      const removeDir = resolveInstallDir(flags);
      const result = await removeSkill(removeDir, skillName);
      if (!result.ok) {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }

      console.log(`✓ Removed '${skillName}'`);
      break;
    }

    case "update": {
      const updateDir = resolveInstallDir(flags);

      if (flags.all !== undefined) {
        console.log("Updating all installed skills...\n");
        const results = await updateAllSkills(updateDir);
        if (results.length === 0) {
          console.log("No skills installed.");
          break;
        }
        for (const r of results) {
          if (!r.ok) {
            console.error(`  ✗ ${r.name}: ${r.error}`);
          } else if (r.from === r.to) {
            console.log(`  ⊘ ${r.name} already up to date (v${r.to})`);
          } else {
            console.log(`  ✓ ${r.name} v${r.from} → v${r.to}`);
          }
        }
        break;
      }

      const skillName = args[0];
      if (!skillName) {
        console.error("Error: skill name required. Usage: agent-skills update <skill>");
        process.exit(1);
      }

      console.log(`Updating '${skillName}'...`);
      const result = await updateSkill(updateDir, skillName);
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

  // Post-command update check (skip for update command)
  if (command !== "update") {
    const checkDir = flags.global !== undefined || flags.g !== undefined ? homedir() : process.cwd();
    const outdated = await checkForUpdates(checkDir);
    if (outdated.length > 0) {
      const list = outdated.map((s) => `${s.name} (v${s.installed} → v${s.latest})`).join(", ");
      console.log(`\n⚠ Updates available: ${list}`);
      console.log("  Run: agent-skills update --all");
    }
  }
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
