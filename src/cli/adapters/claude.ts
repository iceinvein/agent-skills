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

// Quotes a string for a POSIX shell single-quoted literal. The hook command is
// a shell line the harness runs, and both the directive and the install path
// come from outside it: an apostrophe in either would otherwise end the
// literal early and take the whole command down, directive included.
function shq(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

// Identifies whether a SessionStart hook entry belongs to `skillName`.
//
// New entries carry an explicit `skill` field, written by wireSessionStartHook
// below, so identity never depends on what the directive text happens to say.
// Entries wired before this field existed carry no such field. Those are
// recognised two ways: by the directive they echo, when the caller has the
// manifest and can pass it, and failing that by the "Activate <name> skill"
// phrase, which is the only heuristic the fallback path in remove.ts has when
// the manifest could not be fetched. The phrase alone never matched sluice's
// directive, or terse's current one, so every re-install of either appended a
// duplicate: that is what the directive match closes.
function matchesSkillDirective(hook: HookEntry, skillName: string, directive?: string): boolean {
  if (hook.skill !== undefined) return hook.skill === skillName;
  if (directive !== undefined && hook.command.includes(`echo ${shq(directive)}`)) return true;
  return hook.command.includes(`Activate ${skillName} skill`);
}

export async function wireSessionStartHook(
  settingsPath: string,
  skillName: string,
  directive: string,
  scriptPath?: string
): Promise<void> {
  let settings: Settings = {};
  if (existsSync(settingsPath)) {
    settings = await Bun.file(settingsPath).json();
  }
  if (!settings.hooks) settings.hooks = {};
  if (!settings.hooks.SessionStart) settings.hooks.SessionStart = [];

  // The script runs after the echo so the directive is the first thing the
  // session reads, guarded by its own existence so a bundle that moved leaves
  // the directive in place and the hook exiting 0 rather than 127.
  const command = scriptPath
    ? `echo ${shq(directive)}; if [ -f ${shq(scriptPath)} ]; then bash ${shq(scriptPath)}; fi`
    : `echo ${shq(directive)}`;
  const legacy = `echo ${shq(directive)}`;

  // An entry that already belongs to this skill is brought up to the current
  // command rather than left as it was, so a skill that gains a script does not
  // keep running without one on machines that installed early. A legacy entry
  // is adopted only when it is exactly the command an earlier install wrote;
  // one that carries the directive inside something hand-written is the user's,
  // and is left alone without a second copy being added beside it. Duplicates
  // of the plain form, which the old matcher produced on every re-install, are
  // collapsed to the first: adopted as they stand they would run the script
  // once each per session start.
  let adopted = false;
  let custom = false;
  let customRunsScript = false;
  let changed = false;
  for (const group of settings.hooks.SessionStart as HookGroup[]) {
    const kept: HookEntry[] = [];
    for (const hook of group.hooks ?? []) {
      if (!matchesSkillDirective(hook, skillName, directive)) {
        kept.push(hook);
        continue;
      }
      const plain = hook.skill !== undefined || hook.command === legacy;
      if (!plain) {
        custom = true;
        // Someone who already put the script into their own command has done the
        // one thing the warning below asks for, and repeating it on every update
        // is the one notice they have no way to switch off.
        if (scriptPath && hook.command?.includes(scriptPath)) customRunsScript = true;
        kept.push(hook);
        continue;
      }
      if (adopted) {
        changed = true;
        continue;
      }
      adopted = true;
      if (hook.command !== command || hook.skill !== skillName) {
        hook.command = command;
        hook.skill = skillName;
        changed = true;
      }
      kept.push(hook);
    }
    if (kept.length !== (group.hooks ?? []).length) group.hooks = kept;
  }
  settings.hooks.SessionStart = (settings.hooks.SessionStart as HookGroup[]).filter(
    (group) => !group.hooks || group.hooks.length > 0
  );
  if (adopted || custom) {
    if (custom && !adopted && scriptPath && !customRunsScript) {
      console.warn(
        `${skillName}: a hand-edited SessionStart hook already carries its directive, so it was left as is and ${scriptPath} was not wired; add it to that entry yourself if you want it.`
      );
    }
    if (changed) {
      mkdirSync(dirname(settingsPath), { recursive: true });
      await Bun.write(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    }
    return;
  }

  settings.hooks.SessionStart.push({
    hooks: [{ type: "command", command, skill: skillName }],
  });

  mkdirSync(dirname(settingsPath), { recursive: true });
  await Bun.write(settingsPath, JSON.stringify(settings, null, 2) + "\n");
}

export async function unwireSessionStartHook(
  settingsPath: string,
  skillName: string,
  directive?: string
): Promise<void> {
  if (!existsSync(settingsPath)) return;

  const settings: Settings = await Bun.file(settingsPath).json();
  const sessionStart = settings.hooks?.SessionStart as HookGroup[] | undefined;
  if (!sessionStart) return;

  // The same rule as wiring: an entry this tool wrote goes, an entry the user
  // wrote around the directive stays, since removing the skill is no licence
  // to delete a command that was never the tool's to begin with.
  const legacy = directive === undefined ? undefined : `echo ${shq(directive)}`;
  const ours = (h: HookEntry) =>
    matchesSkillDirective(h, skillName, directive) &&
    (h.skill !== undefined || legacy === undefined || h.command === legacy);
  const filteredGroups = sessionStart
    .map((group) => ({
      hooks: (group.hooks ?? []).filter((h) => !ours(h)),
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

// A Stop hook carries no directive, so it is keyed by the marker alone: one
// entry per skill, brought up to the current command on every install.
export async function wireStopHook(
  settingsPath: string,
  skillName: string,
  scriptPath: string
): Promise<void> {
  let settings: Settings = {};
  if (existsSync(settingsPath)) {
    settings = await Bun.file(settingsPath).json();
  }
  if (!settings.hooks) settings.hooks = {};
  if (!settings.hooks.Stop) settings.hooks.Stop = [];

  const command = `if [ -f ${shq(scriptPath)} ]; then bash ${shq(scriptPath)}; fi`;
  let found = false;
  for (const group of settings.hooks.Stop as HookGroup[]) {
    for (const hook of group.hooks ?? []) {
      if (hook.skill !== skillName) continue;
      found = true;
      hook.command = command;
    }
  }
  if (!found) {
    settings.hooks.Stop.push({ hooks: [{ type: "command", command, skill: skillName }] });
  }
  mkdirSync(dirname(settingsPath), { recursive: true });
  await Bun.write(settingsPath, JSON.stringify(settings, null, 2) + "\n");
}

export async function unwireStopHook(settingsPath: string, skillName: string): Promise<void> {
  if (!existsSync(settingsPath)) return;
  const settings: Settings = await Bun.file(settingsPath).json();
  const stop = settings.hooks?.Stop as HookGroup[] | undefined;
  if (!stop) return;

  const filtered = stop
    .map((group) => ({ hooks: (group.hooks ?? []).filter((h) => h.skill !== skillName) }))
    .filter((group) => group.hooks.length > 0);
  if (filtered.length === 0) {
    delete settings.hooks.Stop;
  } else {
    settings.hooks.Stop = filtered;
  }
  if (settings.hooks && Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }
  await Bun.write(settingsPath, JSON.stringify(settings, null, 2) + "\n");
}

// The statusLine is a single slot, not a list like the hook keys, so claiming
// it is only safe while it refuses one that is already spoken for. An empty
// slot is taken and given back on removal; anything already there is left
// exactly as it stands, on install and on removal alike, because a statusline
// someone wrote is not ours to replace or to delete.
//
// Guarded by the script's own existence, exactly as the two hook commands above
// are and for the same reason: a bundle that moved leaves the bar silent rather
// than running a path that is gone. That reason is sharper here than it is for
// a hook, because this is the command that runs on every keystroke, so an
// unguarded one spends the rest of the session printing 127 to stderr.
function statusLineCommand(scriptPath: string): string {
  return `if [ -f ${shq(scriptPath)} ]; then bash ${shq(scriptPath)}; fi`;
}

// Whether the slot holds a command this tool wrote for `skillName`.
//
// Matched as the whole command, never as a substring: `bash mine.sh; bash
// ours.sh` contains ours and belongs to whoever composed it, and overwriting it
// destroys the half we did not write. The skill directory has to be in the path
// because the slot is shared between every skill that might declare one, and
// keying it off a fixed name would let the second such skill take the first
// one's statusline on install and delete it on removal.
//
// What this deliberately cannot tell apart: someone who vendored this skill
// into their own tree and pointed the slot at their copy. That command is
// byte-identical to one of ours, so it is treated as ours, re-pointed on
// install and cleared on removal. Their file is never touched, only the
// setting, and recording ownership properly would mean a marker field inside a
// value the harness defines.
function ownsStatusLine(command: unknown, skillName: string, scriptPath?: string): boolean {
  if (typeof command !== "string") return false;
  if (scriptPath !== undefined && command === statusLineCommand(scriptPath)) return true;

  const shape = /^if \[ -f '(.*)' \]; then bash '(.*)'; fi$/.exec(command);
  if (shape === null || shape[1] !== shape[2]) return false;
  return shape[1]!.includes(`/skills/${skillName}/`);
}

export async function wireStatusLine(
  settingsPath: string,
  skillName: string,
  scriptPath: string
): Promise<void> {
  let settings: Settings = {};
  if (existsSync(settingsPath)) {
    settings = await Bun.file(settingsPath).json();
  }

  // `null` is how the key is present and the feature off, which is an empty
  // slot. Read as occupied it would be unclaimable for good.
  const existing = settings.statusLine;
  if (existing !== undefined && existing !== null) {
    if (!ownsStatusLine(existing?.command, skillName, scriptPath)) return;
  }

  const command = statusLineCommand(scriptPath);
  if (existing?.type === "command" && existing?.command === command) return;

  settings.statusLine = { type: "command", command };
  mkdirSync(dirname(settingsPath), { recursive: true });
  await Bun.write(settingsPath, JSON.stringify(settings, null, 2) + "\n");
}

// `scriptPath` is optional because the offline removal path has the skill's
// name but no manifest to resolve a bundle path from, and the slot names the
// skill either way.
export async function unwireStatusLine(
  settingsPath: string,
  skillName: string,
  scriptPath?: string
): Promise<void> {
  if (!existsSync(settingsPath)) return;
  const settings: Settings = await Bun.file(settingsPath).json();
  if (settings.statusLine === undefined || settings.statusLine === null) return;
  if (!ownsStatusLine(settings.statusLine?.command, skillName, scriptPath)) return;

  delete settings.statusLine;
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
      const script = manifest.activation.claudeHookScript;
      const scriptPath =
        script && config.bundleRoot ? join(cwd, config.bundleRoot, script) : undefined;
      await wireSessionStartHook(settingsPath, manifest.name, manifest.activation.claudeHookDirective, scriptPath);
      if (!installed.includes(".claude/settings.json")) {
        installed.push(".claude/settings.json");
      }
    }

    if (activation === "global" && manifest.activation?.claudeStopScript && config.bundleRoot) {
      const settingsPath = join(cwd, ".claude/settings.json");
      await wireStopHook(settingsPath, manifest.name, join(cwd, config.bundleRoot, manifest.activation.claudeStopScript));
      if (!installed.includes(".claude/settings.json")) {
        installed.push(".claude/settings.json");
      }
    }

    if (activation === "global" && manifest.activation?.claudeStatuslineScript && config.bundleRoot) {
      const settingsPath = join(cwd, ".claude/settings.json");
      await wireStatusLine(
        settingsPath,
        manifest.name,
        join(cwd, config.bundleRoot, manifest.activation.claudeStatuslineScript)
      );
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
      await unwireSessionStartHook(settingsPath, manifest.name, manifest.activation.claudeHookDirective);
    }
    if (manifest.activation?.claudeStopScript) {
      await unwireStopHook(join(cwd, ".claude/settings.json"), manifest.name);
    }
    if (manifest.activation?.claudeStatuslineScript && config.bundleRoot) {
      await unwireStatusLine(
        join(cwd, ".claude/settings.json"),
        manifest.name,
        join(cwd, config.bundleRoot, manifest.activation.claudeStatuslineScript)
      );
    }
  },
};
