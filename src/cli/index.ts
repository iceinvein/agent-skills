#!/usr/bin/env bun
import { detectTools } from "./detect";
import { fetchSkillManifest, fetchAllSkillFiles } from "./github";
import { installSkill } from "./commands/install";
import { removeSkill } from "./commands/remove";
import { listSkills } from "./commands/list";
import { infoSkill } from "./commands/info";
import { updateSkill, updateAllSkills } from "./commands/update";
import { bumpSkill, bumpAllChanged } from "./commands/bump";
import { checkForUpdates } from "./update-check";
import { TOOL_NAMES, type ToolName, type ActivationMode } from "./types";
import { browseAndSelect, pickActivation, pickTools } from "./tui";
import type { BumpLevel } from "./semver";
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

const BOOLEAN_FLAGS = new Set(["global", "g", "all", "dry-run"]);

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
  agent-skills install <skill> [<skill> ...]  [--tool <tool>] [--activation <mode>] [-g]  Install one or more skills
  agent-skills install                         [--tool <tool>] [-g]   No args: opens interactive picker
  agent-skills browse                          [--tool <tool>] [-g]   Alias for 'install' with picker
  agent-skills remove  <skill>  [-g]                   Remove a skill
  agent-skills update  <skill>  [-g]                   Update a skill
  agent-skills update  --all    [-g]                   Update all installed skills
  agent-skills bump   <skill>  [patch|minor|major]     Bump a skill's version
  agent-skills bump   --all    [patch|minor|major]     Bump all changed skills
  agent-skills list                                    List available skills
  agent-skills info    <skill>                         Show skill details

Flags:
  --tool <tool>   Install for a specific tool (${TOOL_NAMES.join(", ")})
  -g, --global    Install to home directory (available in all projects)
  --dry-run       With bump --all: check without writing (exit 1 if unbumped)
  --activation <mode>  Set activation mode for skills that support it (session or global)
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

type InstallFlags = {
  tool?: string;
  activation?: string;
};

const TOOL_DIRS: Partial<Record<ToolName, string>> = {
  claude: ".claude",
  cursor: ".cursor",
  gemini: ".gemini",
};

async function resolveTargetTools(
  installDir: string,
  isGlobal: boolean,
  flags: InstallFlags,
): Promise<ToolName[] | null> {
  if (flags.tool) {
    if (!TOOL_NAMES.includes(flags.tool as ToolName)) {
      console.error(`Error: unknown tool '${flags.tool}'. Must be one of: ${TOOL_NAMES.join(", ")}`);
      return null;
    }
    return [flags.tool as ToolName];
  }

  const detected = await detectTools(installDir);
  if (detected.length > 0) {
    console.log(`Detected tools: ${detected.join(", ")}`);
    return detected;
  }

  if (!process.stdin.isTTY) {
    console.error(
      "Error: no tools detected and no TTY for prompting. Pass --tool <claude|cursor|codex|gemini>.",
    );
    return null;
  }

  const picked = await pickTools(
    isGlobal
      ? "Which tools do you use?"
      : "No tools detected in this directory. Which tools do you use?",
  );

  for (const tool of picked) {
    const dir = TOOL_DIRS[tool];
    if (dir) mkdirSync(join(installDir, dir), { recursive: true });
  }
  return picked;
}

async function installOne(
  skillName: string,
  installDir: string,
  isGlobal: boolean,
  targetTools: ToolName[],
  flags: InstallFlags,
): Promise<boolean> {
  console.log(`Fetching skill '${skillName}'...`);
  const manifestResult = await fetchSkillManifest(skillName);
  if (!manifestResult.ok) {
    console.error(`Error: ${manifestResult.error}`);
    return false;
  }

  const filesResult = await fetchAllSkillFiles(skillName, manifestResult.manifest);
  if ("error" in filesResult) {
    console.error(`Error: ${filesResult.error}`);
    return false;
  }

  const manifest = manifestResult.manifest;
  let activation: ActivationMode | undefined;
  if (manifest.activation && targetTools.includes("claude")) {
    const validModes = manifest.activation.modes;

    if (flags.activation) {
      if (!validModes.includes(flags.activation as ActivationMode)) {
        console.error(
          `Error: activation mode '${flags.activation}' not supported. Must be one of: ${validModes.join(", ")}`,
        );
        return false;
      }
      activation = flags.activation as ActivationMode;
    } else if (process.stdin.isTTY) {
      activation = await pickActivation(manifest.name, validModes);
    } else {
      activation = manifest.activation.default;
    }
  }

  const result = await installSkill(installDir, manifest, filesResult, targetTools, activation);
  if (!result.ok) {
    console.error(`Error: ${result.error}`);
    return false;
  }

  console.log(`\n✓ Installed '${skillName}' v${manifest.version}${isGlobal ? " (global)" : ""}:`);
  printInstalled(result.installed, result.skipped);
  return true;
}

async function main() {
  const { command, args, flags } = parseArgs(process.argv.slice(2));

  switch (command) {
    case "install":
    case "browse": {
      const installDir = resolveInstallDir(flags);
      const isGlobal = installDir === homedir();

      let names = args;
      if (names.length === 0 || command === "browse") {
        if (!process.stdin.isTTY) {
          console.error(
            "Error: skill name required. Usage: agent-skills install <skill> [<skill> ...]",
          );
          process.exit(1);
        }
        if (isGlobal) console.log(`Browsing for global install (${installDir})`);
        console.log("Fetching skill index...\n");
        const indexResult = await listSkills();
        if (!indexResult.ok) {
          console.error(`Error: ${indexResult.error}`);
          process.exit(1);
        }
        const { picked } = await browseAndSelect(indexResult.skills);
        if (picked.length === 0) {
          console.log("\nNothing selected.");
          break;
        }
        names = picked;
      } else if (isGlobal) {
        console.log(`Installing globally to ${installDir}`);
      }

      const targetTools = await resolveTargetTools(installDir, isGlobal, flags);
      if (!targetTools) process.exit(1);

      if (names.length > 1) {
        console.log(`\nInstalling ${names.length} skills...\n`);
      }

      let failures = 0;
      for (const name of names) {
        const ok = await installOne(name, installDir, isGlobal, targetTools, flags);
        if (!ok) failures++;
      }
      if (failures > 0) process.exit(1);
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

      if (result.from === result.to) {
        console.log(`⊘ '${skillName}' is already up to date (v${result.to})`);
      } else {
        console.log(`✓ Updated '${skillName}' from v${result.from} to v${result.to}`);
      }
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

    case "bump": {
      const BUMP_LEVELS = ["patch", "minor", "major"] as const;

      // Find repo root by looking for skills/ directory
      const repoRoot = import.meta.dir.replace(/\/dist\/cli$|\/src\/cli$/, "");

      if (flags.all !== undefined) {
        const levelArg = args[0] ?? "patch";
        if (!BUMP_LEVELS.includes(levelArg as BumpLevel)) {
          console.error(`Error: invalid bump level '${levelArg}'. Must be one of: ${BUMP_LEVELS.join(", ")}`);
          process.exit(1);
        }
        const dryRun = flags["dry-run"] !== undefined;
        const results = await bumpAllChanged(repoRoot, levelArg as BumpLevel, dryRun);

        if (results.length === 0) {
          if (!dryRun) console.log("All skill versions are up to date.");
          process.exit(0);
        }

        for (const r of results) {
          if (!r.ok) {
            console.error(`  ✗ ${r.name}: ${r.error}`);
          } else if (dryRun) {
            console.log(`  needs bump: ${r.name} ${r.from} → ${r.to}`);
          } else {
            console.log(`  ✓ ${r.name} ${r.from} → ${r.to}`);
          }
        }

        if (dryRun) process.exit(1);
        break;
      }

      const skillName = args[0];
      if (!skillName) {
        console.error("Error: skill name required. Usage: agent-skills bump <skill> [patch|minor|major]");
        process.exit(1);
      }

      const level = (args[1] ?? "patch") as BumpLevel;
      if (!BUMP_LEVELS.includes(level)) {
        console.error(`Error: invalid bump level '${args[1]}'. Must be one of: ${BUMP_LEVELS.join(", ")}`);
        process.exit(1);
      }

      const result = await bumpSkill(repoRoot, skillName, level);
      if (!result.ok) {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }

      console.log(`✓ ${skillName} ${result.from} → ${result.to}`);
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

const CANCEL_ERRORS = new Set(["ExitPromptError", "AbortPromptError", "CancelPromptError"]);

main().catch((err) => {
  const name = err?.name ?? err?.constructor?.name;
  if (CANCEL_ERRORS.has(name)) {
    console.log("\nCancelled.");
    process.exit(130);
  }
  console.error("Fatal:", err.message);
  process.exit(1);
});
