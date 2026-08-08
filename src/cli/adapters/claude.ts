import { chmodSync, existsSync, mkdirSync, rmSync, rmdirSync, statSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ActivationMode, SkillManifest } from "../types";

function shouldBeExecutable(relPath: string, content: string): boolean {
  if (relPath.endsWith(".sh")) return true;
  if (relPath.startsWith("bin/") || relPath.includes("/bin/")) return true;
  if (content.startsWith("#!")) return true;
  return false;
}

function runScript(scriptPath: string, cwd: string): { ok: boolean; code: number } {
  if (!existsSync(scriptPath)) return { ok: true, code: 0 };
  const result = Bun.spawnSync(["bash", scriptPath], {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
  });
  return { ok: result.exitCode === 0, code: result.exitCode ?? 1 };
}

type HookEntry = { type: "command"; command: string; skill?: string };
type HookGroup = { hooks: HookEntry[] };
type Settings = Record<string, any>;

// Identifies whether a SessionStart hook entry belongs to `skillName`.
//
// New entries carry an explicit `skill` field, written by wireSessionStartHook
// below, so identity never depends on what the directive text happens to say.
// Entries wired before this field existed (for example terse's hook on real
// machines today) carry no such field. Those are recognised by the substring
// heuristic this file used exclusively before: it only ever worked because
// terse's directive happens to contain the phrase "Activate terse skill", and
// it silently failed for any directive that does not, which is the bug this
// marker fixes.
function matchesSkillDirective(hook: HookEntry, skillName: string): boolean {
  if (hook.skill !== undefined) return hook.skill === skillName;
  return hook.command.includes(`Activate ${skillName} skill`);
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
      if (matchesSkillDirective(hook, skillName)) return;
    }
  }

  settings.hooks.SessionStart.push({
    hooks: [{ type: "command", command, skill: skillName }],
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
      hooks: (group.hooks ?? []).filter((h) => !matchesSkillDirective(h, skillName)),
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
  install(
    cwd: string,
    manifest: SkillManifest,
    files: Map<string, string>,
    activation?: ActivationMode
  ): Promise<string[]>;
  remove(cwd: string, manifest: SkillManifest, installedFiles: string[]): Promise<void>;
};

export const claudeAdapter: Adapter = {
  name: "claude",

  async install(cwd, manifest, files, activation) {
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

    // Install bundle (directory tree) under bundleRoot
    if (config.bundleRoot && manifest.bundle) {
      const promptPath = manifest.files?.prompt;
      for (const [relPath, content] of files) {
        if (relPath === promptPath) continue; // prompt handled above
        const targetRel = join(config.bundleRoot, relPath);
        const targetPath = join(cwd, targetRel);
        mkdirSync(dirname(targetPath), { recursive: true });
        await Bun.write(targetPath, content);
        if (shouldBeExecutable(relPath, content)) {
          chmodSync(targetPath, 0o755);
        }
        installed.push(targetRel);
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

    if (activation === "global" && manifest.activation?.claudeHookDirective) {
      const settingsPath = join(cwd, ".claude/settings.json");
      await wireSessionStartHook(settingsPath, manifest.name, manifest.activation.claudeHookDirective);
      if (!installed.includes(".claude/settings.json")) {
        installed.push(".claude/settings.json");
      }
    }

    if (config.postinstall && config.bundleRoot) {
      const scriptPath = join(cwd, config.bundleRoot, config.postinstall);
      const result = runScript(scriptPath, join(cwd, config.bundleRoot));
      if (!result.ok) {
        console.error(`postinstall script '${config.postinstall}' exited with code ${result.code}`);
      }
    }

    return installed;
  },

  async remove(cwd, manifest, installedFiles) {
    const config = manifest.install.claude;
    if (!config) return;

    // Run postremove before deleting files (so the script is still on disk)
    if (config.postremove && config.bundleRoot) {
      const scriptPath = join(cwd, config.bundleRoot, config.postremove);
      const result = runScript(scriptPath, join(cwd, config.bundleRoot));
      if (!result.ok) {
        console.error(`postremove script '${config.postremove}' exited with code ${result.code}`);
      }
    }

    // Remove prompt and supporting files
    for (const file of installedFiles) {
      if (file === ".claude/settings.json") continue;
      const fullPath = join(cwd, file);
      if (existsSync(fullPath)) {
        try {
          const stat = statSync(fullPath);
          if (stat.isDirectory()) {
            rmSync(fullPath, { recursive: true, force: true });
          } else {
            unlinkSync(fullPath);
          }
        } catch {}
        // Clean up empty parent directories walking up to bundleRoot
        let dir = dirname(fullPath);
        const stopAt = config.bundleRoot ? join(cwd, config.bundleRoot, "..") : cwd;
        while (dir !== stopAt && dir !== "/" && dir.startsWith(cwd)) {
          // rmdirSync, not rmSync: rmSync on a directory throws unless it is
          // recursive, so this walk used to break on its first step and leave
          // the skill's directory standing empty after every removal. rmdirSync
          // deletes only an empty directory and refuses a populated one, which
          // is exactly the guard this loop wants.
          try { rmdirSync(dir); } catch { break; }
          dir = dirname(dir);
        }
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

    if (manifest.activation?.claudeHookDirective) {
      const settingsPath = join(cwd, ".claude/settings.json");
      await unwireSessionStartHook(settingsPath, manifest.name);
    }
  },
};
