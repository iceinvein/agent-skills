import { test, expect, beforeEach, afterEach } from "bun:test";
import {
  claudeAdapter,
  wireSessionStartHook,
  unwireSessionStartHook,
  wireStatusLine,
  unwireStatusLine,
} from "../../src/cli/adapters/claude";
import type { SkillManifest } from "../../src/cli/types";
import { mkdirSync, rmSync, existsSync } from "node:fs";

type HookGroup = { hooks: Array<{ command: string }> };
import { join } from "node:path";

const TMP = join(import.meta.dir, ".tmp-hooks");
const SETTINGS = join(TMP, "settings.json");

beforeEach(() => {
  mkdirSync(TMP, { recursive: true });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

test("wireSessionStartHook creates settings.json with hook when file missing", async () => {
  await wireSessionStartHook(SETTINGS, "terse", "Activate terse skill at tight level for this session.");
  const contents = await Bun.file(SETTINGS).json();
  expect(contents.hooks.SessionStart).toHaveLength(1);
  expect(contents.hooks.SessionStart[0].hooks[0].type).toBe("command");
  expect(contents.hooks.SessionStart[0].hooks[0].command).toBe(
    "echo 'Activate terse skill at tight level for this session.'"
  );
});

test("wireSessionStartHook is idempotent", async () => {
  await wireSessionStartHook(SETTINGS, "terse", "Activate terse skill at tight level for this session.");
  await wireSessionStartHook(SETTINGS, "terse", "Activate terse skill at tight level for this session.");
  const contents = await Bun.file(SETTINGS).json();
  expect(contents.hooks.SessionStart).toHaveLength(1);
});

test("wireSessionStartHook preserves existing unrelated hooks", async () => {
  await Bun.write(SETTINGS, JSON.stringify({
    hooks: {
      PreToolUse: [{ hooks: [{ type: "command", command: "echo pre" }] }],
      SessionStart: [{ hooks: [{ type: "command", command: "echo other" }] }],
    },
  }));
  await wireSessionStartHook(SETTINGS, "terse", "Activate terse skill at tight level for this session.");
  const contents = await Bun.file(SETTINGS).json();
  expect(contents.hooks.PreToolUse[0].hooks[0].command).toBe("echo pre");
  expect(contents.hooks.SessionStart).toHaveLength(2);
  expect(contents.hooks.SessionStart[0].hooks[0].command).toBe("echo other");
  expect(contents.hooks.SessionStart[1].hooks[0].command).toContain("Activate terse skill");
});

test("wireSessionStartHook preserves unrelated top-level settings", async () => {
  await Bun.write(SETTINGS, JSON.stringify({
    mcpServers: { foo: { command: "foo", args: [] } },
  }));
  await wireSessionStartHook(SETTINGS, "terse", "Activate terse skill at tight level for this session.");
  const contents = await Bun.file(SETTINGS).json();
  expect(contents.mcpServers.foo).toBeDefined();
  expect(contents.hooks.SessionStart).toHaveLength(1);
});

test("unwireSessionStartHook strips only matching entry", async () => {
  await Bun.write(SETTINGS, JSON.stringify({
    hooks: {
      SessionStart: [
        { hooks: [{ type: "command", command: "echo other" }] },
        { hooks: [{ type: "command", command: "echo 'Activate terse skill at tight level for this session.'" }] },
      ],
    },
  }));
  await unwireSessionStartHook(SETTINGS, "terse");
  const contents = await Bun.file(SETTINGS).json();
  expect(contents.hooks.SessionStart).toHaveLength(1);
  expect(contents.hooks.SessionStart[0].hooks[0].command).toBe("echo other");
});

test("unwireSessionStartHook cleans up emptied SessionStart array and hooks key", async () => {
  await Bun.write(SETTINGS, JSON.stringify({
    hooks: {
      SessionStart: [
        { hooks: [{ type: "command", command: "echo 'Activate terse skill at tight level for this session.'" }] },
      ],
    },
  }));
  await unwireSessionStartHook(SETTINGS, "terse");
  const contents = await Bun.file(SETTINGS).json();
  expect(contents.hooks).toBeUndefined();
});

test("unwireSessionStartHook is a no-op when file missing", async () => {
  await unwireSessionStartHook(SETTINGS, "terse");
  expect(existsSync(SETTINGS)).toBe(false);
});

test("unwireSessionStartHook preserves hooks in other events", async () => {
  await Bun.write(SETTINGS, JSON.stringify({
    hooks: {
      PreToolUse: [{ hooks: [{ type: "command", command: "echo pre" }] }],
      SessionStart: [
        { hooks: [{ type: "command", command: "echo 'Activate terse skill at tight level for this session.'" }] },
      ],
    },
  }));
  await unwireSessionStartHook(SETTINGS, "terse");
  const contents = await Bun.file(SETTINGS).json();
  expect(contents.hooks.PreToolUse[0].hooks[0].command).toBe("echo pre");
  expect(contents.hooks.SessionStart).toBeUndefined();
});

test("wireSessionStartHook tolerates groups with no hooks array", async () => {
  // Simulate a malformed/third-party entry missing the `hooks` key
  await Bun.write(SETTINGS, JSON.stringify({
    hooks: {
      SessionStart: [{ someOtherField: "value" }],
    },
  }));
  await wireSessionStartHook(SETTINGS, "terse", "Activate terse skill at tight level for this session.");
  const contents = await Bun.file(SETTINGS).json();
  expect(contents.hooks.SessionStart).toHaveLength(2);
  expect(contents.hooks.SessionStart[1].hooks[0].command).toContain("Activate terse skill");
});

test("unwireSessionStartHook tolerates groups with no hooks array", async () => {
  await Bun.write(SETTINGS, JSON.stringify({
    hooks: {
      SessionStart: [
        { someOtherField: "value" },
        { hooks: [{ type: "command", command: "echo 'Activate terse skill at tight level for this session.'" }] },
      ],
    },
  }));
  await unwireSessionStartHook(SETTINGS, "terse");
  const contents = await Bun.file(SETTINGS).json();
  // Groups without hooks array are filtered out (empty filteredGroups)
  // because filteredGroups filters to groups with hooks.length > 0
  expect(contents.hooks).toBeUndefined();
});

test("claudeAdapter.install wires hook when activation is global", async () => {
  const manifest: SkillManifest = {
    name: "terse",
    version: "1.0.0",
    description: "x",
    author: "a",
    type: "prompt",
    tools: ["claude"],
    files: { prompt: "SKILL.md" },
    install: { claude: { prompt: ".claude/skills/terse/SKILL.md" } },
    activation: {
      modes: ["session", "global"],
      default: "session",
      claudeHookDirective: "Activate terse skill at tight level for this session.",
    },
  };
  const files = new Map([["SKILL.md", "# Terse"]]);
  const installed = await claudeAdapter.install(TMP, manifest, files, "global");
  const contents = await Bun.file(join(TMP, ".claude/settings.json")).json();
  expect(contents.hooks.SessionStart[0].hooks[0].command).toContain("Activate terse skill");
  expect(installed).toContain(".claude/settings.json");
});

test("claudeAdapter.install does not wire hook when activation is session", async () => {
  const manifest: SkillManifest = {
    name: "terse",
    version: "1.0.0",
    description: "x",
    author: "a",
    type: "prompt",
    tools: ["claude"],
    files: { prompt: "SKILL.md" },
    install: { claude: { prompt: ".claude/skills/terse/SKILL.md" } },
    activation: {
      modes: ["session", "global"],
      default: "session",
      claudeHookDirective: "Activate terse skill at tight level for this session.",
    },
  };
  const files = new Map([["SKILL.md", "# Terse"]]);
  await claudeAdapter.install(TMP, manifest, files, "session");
  expect(existsSync(join(TMP, ".claude/settings.json"))).toBe(false);
});

test("wireSessionStartHook is idempotent for a directive that never mentions the skill name", async () => {
  // Regression for the sluice bug: matchesSkillDirective used to require the
  // literal phrase "Activate <name> skill" inside the directive text. sluice's
  // directive never says "Activate sluice skill", so the old matcher never
  // found its own hook and every re-install appended a duplicate.
  const directive = "Before acting on a request that changes code, pick a sluice channel and state which one.";
  await wireSessionStartHook(SETTINGS, "sluice", directive);
  await wireSessionStartHook(SETTINGS, "sluice", directive);
  const contents = await Bun.file(SETTINGS).json();
  expect(contents.hooks.SessionStart).toHaveLength(1);
});

test("wireSessionStartHook recognises a legacy terse-shaped hook already on disk", async () => {
  // Hooks wired before the identity marker existed (e.g. terse on real
  // machines) have no marker at all, only the directive text baked into the
  // command. A fresh install for a different skill must not disturb that
  // entry, and re-wiring terse itself must still recognise it as its own.
  await Bun.write(SETTINGS, JSON.stringify({
    hooks: {
      SessionStart: [
        { hooks: [{ type: "command", command: "echo 'Activate terse skill at tight level for this session.'" }] },
      ],
    },
  }));

  await wireSessionStartHook(SETTINGS, "sluice", "Before acting on a request that changes code, pick a sluice channel and state which one.");
  await wireSessionStartHook(SETTINGS, "terse", "Activate terse skill at tight level for this session.");

  const contents = await Bun.file(SETTINGS).json();
  expect(contents.hooks.SessionStart).toHaveLength(2);
  expect(contents.hooks.SessionStart[0].hooks[0].command).toContain("Activate terse skill");
  expect(contents.hooks.SessionStart[1].hooks[0].command).toContain("sluice channel");
});

test("claudeAdapter.remove unwires hook", async () => {
  const settingsPath = join(TMP, ".claude/settings.json");
  mkdirSync(join(TMP, ".claude"), { recursive: true });
  await wireSessionStartHook(settingsPath, "terse", "Activate terse skill at tight level for this session.");

  const manifest: SkillManifest = {
    name: "terse",
    version: "1.0.0",
    description: "x",
    author: "a",
    type: "prompt",
    tools: ["claude"],
    files: { prompt: "SKILL.md" },
    install: { claude: { prompt: ".claude/skills/terse/SKILL.md" } },
    activation: {
      modes: ["session", "global"],
      default: "session",
      claudeHookDirective: "Activate terse skill at tight level for this session.",
    },
  };
  await claudeAdapter.remove(TMP, manifest, [".claude/skills/terse/SKILL.md"]);
  const contents = await Bun.file(settingsPath).json();
  expect(contents.hooks).toBeUndefined();
});

// A directive is a sentence the model reads; a script is something the hook
// runs. sluice needs the second so a session that starts, resumes or compacts
// in a tree with a live run is shown that run rather than left to remember it.
test("wireSessionStartHook runs the skill's script after the directive when one is given", async () => {
  await wireSessionStartHook(SETTINGS, "sluice", "Pick a channel.", "/opt/skills/sluice/scripts/session-start.sh");
  const contents = await Bun.file(SETTINGS).json();
  expect(contents.hooks.SessionStart[0].hooks[0].command).toBe(
    "echo 'Pick a channel.'; if [ -f '/opt/skills/sluice/scripts/session-start.sh' ]; then bash '/opt/skills/sluice/scripts/session-start.sh'; fi"
  );
});

test("wireSessionStartHook replaces its own entry's command when it changes", async () => {
  await wireSessionStartHook(SETTINGS, "sluice", "Pick a channel.");
  await wireSessionStartHook(SETTINGS, "sluice", "Pick a channel.", "/opt/skills/sluice/scripts/session-start.sh");
  const contents = await Bun.file(SETTINGS).json();
  expect(contents.hooks.SessionStart).toHaveLength(1);
  expect(contents.hooks.SessionStart[0].hooks[0].command).toContain("session-start.sh");
});

test("claudeAdapter.install resolves the hook script under the installed bundle root", async () => {
  const manifest: SkillManifest = {
    name: "sluice",
    version: "1.0.0",
    description: "x",
    author: "a",
    type: "prompt",
    tools: ["claude"],
    files: { prompt: "SKILL.md" },
    bundle: { include: ["scripts"] },
    install: { claude: { prompt: ".claude/skills/sluice/SKILL.md", bundleRoot: ".claude/skills/sluice" } },
    activation: {
      modes: ["session", "global"],
      default: "global",
      claudeHookDirective: "Pick a channel.",
      claudeHookScript: "scripts/session-start.sh",
    },
  };
  const files = new Map([
    ["SKILL.md", "# Sluice"],
    ["scripts/session-start.sh", "#!/usr/bin/env bash\n"],
  ]);
  await claudeAdapter.install(TMP, manifest, files, "global");
  const contents = await Bun.file(join(TMP, ".claude/settings.json")).json();
  const script = join(TMP, ".claude/skills/sluice/scripts/session-start.sh");
  expect(contents.hooks.SessionStart[0].hooks[0].command).toBe(
    `echo 'Pick a channel.'; if [ -f '${script}' ]; then bash '${script}'; fi`
  );
});

// Entries wired before the `skill` marker existed carry only the directive. A
// directive that never says "Activate <name> skill" (sluice's, and terse's
// current one) was therefore never recognised as the skill's own, so every
// install appended another copy and none of them ever gained the script.
test("wireSessionStartHook adopts a plain legacy entry carrying its directive instead of appending", async () => {
  await Bun.write(SETTINGS, JSON.stringify({
    hooks: { SessionStart: [{ hooks: [{ type: "command", command: "echo 'Pick a channel.'" }] }] },
  }));
  await wireSessionStartHook(SETTINGS, "sluice", "Pick a channel.", "/opt/s/session-start.sh");
  const contents = await Bun.file(SETTINGS).json();
  expect(contents.hooks.SessionStart).toHaveLength(1);
  expect(contents.hooks.SessionStart[0].hooks[0].skill).toBe("sluice");
  expect(contents.hooks.SessionStart[0].hooks[0].command).toContain("session-start.sh");
});

test("wireSessionStartHook leaves a hand-edited entry carrying its directive alone and appends nothing", async () => {
  const custom = `case "\${CLAUDE_CONFIG_DIR:-}" in *other*) ;; *) echo 'Pick a channel.' ;; esac`;
  await Bun.write(SETTINGS, JSON.stringify({
    hooks: { SessionStart: [{ hooks: [{ type: "command", command: custom }] }] },
  }));
  await wireSessionStartHook(SETTINGS, "sluice", "Pick a channel.", "/opt/s/session-start.sh");
  const contents = await Bun.file(SETTINGS).json();
  expect(contents.hooks.SessionStart).toHaveLength(1);
  expect(contents.hooks.SessionStart[0].hooks[0].command).toBe(custom);
});

test("unwireSessionStartHook removes a legacy entry when given the directive", async () => {
  await Bun.write(SETTINGS, JSON.stringify({
    hooks: { SessionStart: [
      { hooks: [{ type: "command", command: "echo other" }] },
      { hooks: [{ type: "command", command: "echo 'Pick a channel.'" }] },
    ] },
  }));
  await unwireSessionStartHook(SETTINGS, "sluice", "Pick a channel.");
  const contents = await Bun.file(SETTINGS).json();
  expect(contents.hooks.SessionStart).toHaveLength(1);
  expect(contents.hooks.SessionStart[0].hooks[0].command).toBe("echo other");
});

// The command is a shell line the harness runs, so what goes into it is
// quoted for the shell: a path or directive with an apostrophe must still run,
// and a script that is not where the install put it must not fail the hook.
function sh(command: string) {
  const proc = Bun.spawnSync({ cmd: ["bash", "-c", command], timeout: 5000 });
  return { code: proc.exitCode, out: proc.stdout.toString() };
}

test("a single quote in the directive or the script path is quoted for the shell", async () => {
  const script = join(TMP, "o'brien dir", "session-start.sh");
  mkdirSync(join(TMP, "o'brien dir"), { recursive: true });
  await Bun.write(script, "#!/usr/bin/env bash\necho SCRIPT-RAN\n");
  await wireSessionStartHook(SETTINGS, "sluice", "Don't skip the channel.", script);
  const command = (await Bun.file(SETTINGS).json()).hooks.SessionStart[0].hooks[0].command as string;
  const r = sh(command);
  expect(r.code).toBe(0);
  expect(r.out).toBe("Don't skip the channel.\nSCRIPT-RAN\n");
});

// Two identical legacy entries were the symptom of the matcher bug; adopting
// both would run the hook script twice per session start, so the first is
// adopted and the rest go.
test("wireSessionStartHook collapses duplicate legacy entries into one", async () => {
  await Bun.write(SETTINGS, JSON.stringify({
    hooks: { SessionStart: [
      { hooks: [{ type: "command", command: "echo other" }] },
      { hooks: [{ type: "command", command: "echo 'Pick a channel.'" }] },
      { hooks: [{ type: "command", command: "echo 'Pick a channel.'" }] },
    ] },
  }));
  await wireSessionStartHook(SETTINGS, "sluice", "Pick a channel.", "/opt/s/session-start.sh");
  const contents = await Bun.file(SETTINGS).json();
  const commands = (contents.hooks.SessionStart as HookGroup[]).flatMap((g) => g.hooks.map((h) => h.command));
  expect(commands).toHaveLength(2);
  expect(commands[0]).toBe("echo other");
  expect(commands[1]).toContain("session-start.sh");
});

test("wireSessionStartHook says so when a hand-written entry means the script was not wired", async () => {
  const custom = `case "\${CLAUDE_CONFIG_DIR:-}" in *other*) ;; *) echo 'Pick a channel.' ;; esac`;
  await Bun.write(SETTINGS, JSON.stringify({
    hooks: { SessionStart: [{ hooks: [{ type: "command", command: custom }] }] },
  }));
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (msg: string) => { warnings.push(String(msg)); };
  try {
    await wireSessionStartHook(SETTINGS, "sluice", "Pick a channel.", "/opt/s/session-start.sh");
  } finally {
    console.warn = original;
  }
  expect(warnings.join("\n")).toMatch(/session-start\.sh/);
  expect(warnings.join("\n")).toMatch(/hand|custom|edited/i);
});

// The warning is a to-do list of one item. Someone who has already wired the
// script into their own command has done it, and repeating it on every update
// turns a one-time instruction into noise they cannot switch off.
test("wireSessionStartHook stays quiet when the hand-written entry already runs the script", async () => {
  const custom = `case "\${CLAUDE_CONFIG_DIR:-}" in *other*) ;; *) echo 'Pick a channel.'; bash /opt/s/session-start.sh ;; esac`;
  await Bun.write(SETTINGS, JSON.stringify({
    hooks: { SessionStart: [{ hooks: [{ type: "command", command: custom }] }] },
  }));
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (msg: string) => { warnings.push(String(msg)); };
  try {
    await wireSessionStartHook(SETTINGS, "sluice", "Pick a channel.", "/opt/s/session-start.sh");
  } finally {
    console.warn = original;
  }
  expect(warnings).toEqual([]);
});

test("and still leaves that entry exactly as it was written", async () => {
  const custom = `case "\${CLAUDE_CONFIG_DIR:-}" in *other*) ;; *) echo 'Pick a channel.'; bash /opt/s/session-start.sh ;; esac`;
  await Bun.write(SETTINGS, JSON.stringify({
    hooks: { SessionStart: [{ hooks: [{ type: "command", command: custom }] }] },
  }));
  await wireSessionStartHook(SETTINGS, "sluice", "Pick a channel.", "/opt/s/session-start.sh");
  const contents = await Bun.file(SETTINGS).json();
  expect(contents.hooks.SessionStart).toHaveLength(1);
  expect(contents.hooks.SessionStart[0].hooks[0].command).toBe(custom);
});

test("unwireSessionStartHook leaves a hand-written entry carrying the directive in place", async () => {
  const custom = `case "\${CLAUDE_CONFIG_DIR:-}" in *other*) ;; *) echo 'Pick a channel.' ;; esac`;
  await Bun.write(SETTINGS, JSON.stringify({
    hooks: { SessionStart: [
      { hooks: [{ type: "command", command: custom }] },
      { hooks: [{ type: "command", command: "echo 'Pick a channel.'" }] },
    ] },
  }));
  await unwireSessionStartHook(SETTINGS, "sluice", "Pick a channel.");
  const contents = await Bun.file(SETTINGS).json();
  expect(contents.hooks.SessionStart).toHaveLength(1);
  expect(contents.hooks.SessionStart[0].hooks[0].command).toBe(custom);
});

test("a hook whose script is missing still prints the directive and exits 0", async () => {
  await wireSessionStartHook(SETTINGS, "sluice", "Pick a channel.", "/nonexistent/session-start.sh");
  const command = (await Bun.file(SETTINGS).json()).hooks.SessionStart[0].hooks[0].command as string;
  const r = sh(command);
  expect(r.code).toBe(0);
  expect(r.out.trim()).toBe("Pick a channel.");
});

// A Stop hook is the second hook kind a skill can carry: a script the harness
// runs when the model tries to end its turn. Marker-keyed like the rest.
import { wireStopHook, unwireStopHook } from "../../src/cli/adapters/claude";

test("wireStopHook adds a marked Stop entry running the script", async () => {
  await wireStopHook(SETTINGS, "sluice", "/opt/s/stop-guard.sh");
  const contents = await Bun.file(SETTINGS).json();
  expect(contents.hooks.Stop).toHaveLength(1);
  expect(contents.hooks.Stop[0].hooks[0].skill).toBe("sluice");
  expect(contents.hooks.Stop[0].hooks[0].command).toBe(
    "if [ -f '/opt/s/stop-guard.sh' ]; then bash '/opt/s/stop-guard.sh'; fi"
  );
});

test("wireStopHook updates its own entry rather than appending", async () => {
  await wireStopHook(SETTINGS, "sluice", "/opt/s/stop-guard.sh");
  await wireStopHook(SETTINGS, "sluice", "/opt/t/stop-guard.sh");
  const contents = await Bun.file(SETTINGS).json();
  expect(contents.hooks.Stop).toHaveLength(1);
  expect(contents.hooks.Stop[0].hooks[0].command).toContain("/opt/t/");
});

test("unwireStopHook removes only the skill's Stop entry", async () => {
  await Bun.write(SETTINGS, JSON.stringify({
    hooks: { Stop: [{ hooks: [{ type: "command", command: "echo other" }] }] },
  }));
  await wireStopHook(SETTINGS, "sluice", "/opt/s/stop-guard.sh");
  await unwireStopHook(SETTINGS, "sluice");
  const contents = await Bun.file(SETTINGS).json();
  expect(contents.hooks.Stop).toHaveLength(1);
  expect(contents.hooks.Stop[0].hooks[0].command).toBe("echo other");
});

test("claudeAdapter.install wires the Stop hook under the bundle root, and remove unwires it", async () => {
  const manifest: SkillManifest = {
    name: "sluice",
    version: "1.0.0",
    description: "x",
    author: "a",
    type: "prompt",
    tools: ["claude"],
    files: { prompt: "SKILL.md" },
    bundle: { include: ["scripts"] },
    install: { claude: { prompt: ".claude/skills/sluice/SKILL.md", bundleRoot: ".claude/skills/sluice" } },
    activation: {
      modes: ["session", "global"],
      default: "global",
      claudeHookDirective: "Pick a channel.",
      claudeStopScript: "scripts/stop-guard.sh",
    },
  };
  const files = new Map([
    ["SKILL.md", "# Sluice"],
    ["scripts/stop-guard.sh", "#!/usr/bin/env bash\n"],
  ]);
  const installed = await claudeAdapter.install(TMP, manifest, files, "global");
  const settingsPath = join(TMP, ".claude/settings.json");
  const contents = await Bun.file(settingsPath).json();
  expect(contents.hooks.Stop[0].hooks[0].command).toContain(join(TMP, ".claude/skills/sluice/scripts/stop-guard.sh"));
  await claudeAdapter.remove(TMP, manifest, installed);
  const after = await Bun.file(settingsPath).json();
  expect(after.hooks?.Stop).toBeUndefined();
});

test("claudeAdapter.install does not wire the Stop hook for a session activation", async () => {
  const manifest: SkillManifest = {
    name: "sluice",
    version: "1.0.0",
    description: "x",
    author: "a",
    type: "prompt",
    tools: ["claude"],
    files: { prompt: "SKILL.md" },
    bundle: { include: ["scripts"] },
    install: { claude: { prompt: ".claude/skills/sluice/SKILL.md", bundleRoot: ".claude/skills/sluice" } },
    activation: { modes: ["session", "global"], default: "global", claudeStopScript: "scripts/stop-guard.sh" },
  };
  await claudeAdapter.install(TMP, manifest, new Map([["SKILL.md", "# S"]]), "session");
  expect(existsSync(join(TMP, ".claude/settings.json"))).toBe(false);
});

// One skill claiming the single statusLine slot is only safe while it refuses
// to take one that is already spoken for, and gives it back on removal. Both
// directions are the test; the wiring on its own is the easy half.
test("wireStatusLine claims the slot when it is empty", async () => {
  await wireStatusLine(SETTINGS, "sluice", "/bundle/skills/sluice/scripts/statusline-command.sh");
  const contents = await Bun.file(SETTINGS).json();
  expect(contents.statusLine.type).toBe("command");
  expect(contents.statusLine.command).toContain("/bundle/skills/sluice/scripts/statusline-command.sh");
});

test("wireStatusLine creates settings.json when the file is missing", async () => {
  rmSync(SETTINGS, { force: true });
  await wireStatusLine(SETTINGS, "sluice", "/bundle/skills/sluice/scripts/statusline-command.sh");
  expect(existsSync(SETTINGS)).toBe(true);
});

test("wireStatusLine leaves a statusline someone else configured alone", async () => {
  await Bun.write(SETTINGS, JSON.stringify({
    statusLine: { type: "command", command: 'bash "$HOME/.claude/mine.sh"' },
  }));
  await wireStatusLine(SETTINGS, "sluice", "/bundle/skills/sluice/scripts/statusline-command.sh");
  const contents = await Bun.file(SETTINGS).json();
  expect(contents.statusLine.command).toBe('bash "$HOME/.claude/mine.sh"');
});

test("wireStatusLine preserves unrelated top-level settings", async () => {
  await Bun.write(SETTINGS, JSON.stringify({ effortLevel: "high" }));
  await wireStatusLine(SETTINGS, "sluice", "/bundle/skills/sluice/scripts/statusline-command.sh");
  const contents = await Bun.file(SETTINGS).json();
  expect(contents.effortLevel).toBe("high");
  expect(contents.statusLine).toBeDefined();
});

test("wireStatusLine is idempotent", async () => {
  await wireStatusLine(SETTINGS, "sluice", "/bundle/skills/sluice/scripts/statusline-command.sh");
  const first = await Bun.file(SETTINGS).text();
  await wireStatusLine(SETTINGS, "sluice", "/bundle/skills/sluice/scripts/statusline-command.sh");
  expect(await Bun.file(SETTINGS).text()).toBe(first);
});

// A path that moved between installs is still ours: the slot is re-pointed
// rather than left aimed at a script that is no longer there.
test("wireStatusLine re-points its own entry when the bundle path changes", async () => {
  await wireStatusLine(SETTINGS, "sluice", "/old/.claude/skills/sluice/scripts/statusline-command.sh");
  await wireStatusLine(SETTINGS, "sluice", "/new/.claude/skills/sluice/scripts/statusline-command.sh");
  const contents = await Bun.file(SETTINGS).json();
  expect(contents.statusLine.command).toContain("/new/.claude/skills/sluice");
  expect(contents.statusLine.command).not.toContain("/old/");
});

// Sharing a filename is not sharing an owner. Matching on the basename alone
// would claim this on install and delete it on removal.
test("wireStatusLine leaves a same-named script of the user's own alone", async () => {
  const theirs = 'bash "$HOME/dotfiles/scripts/statusline-command.sh"';
  await Bun.write(SETTINGS, JSON.stringify({ statusLine: { type: "command", command: theirs } }));

  await wireStatusLine(SETTINGS, "sluice", "/bundle/skills/sluice/scripts/statusline-command.sh");
  expect((await Bun.file(SETTINGS).json()).statusLine.command).toBe(theirs);

  await unwireStatusLine(SETTINGS, "sluice", "/bundle/skills/sluice/scripts/statusline-command.sh");
  expect((await Bun.file(SETTINGS).json()).statusLine.command).toBe(theirs);
});

test("unwireStatusLine gives the slot back when it is still ours", async () => {
  await wireStatusLine(SETTINGS, "sluice", "/bundle/skills/sluice/scripts/statusline-command.sh");
  await unwireStatusLine(SETTINGS, "sluice", "/bundle/skills/sluice/scripts/statusline-command.sh");
  const contents = await Bun.file(SETTINGS).json();
  expect(contents.statusLine).toBeUndefined();
});

test("unwireStatusLine leaves a statusline someone else configured alone", async () => {
  await Bun.write(SETTINGS, JSON.stringify({
    statusLine: { type: "command", command: 'bash "$HOME/.claude/mine.sh"' },
  }));
  await unwireStatusLine(SETTINGS, "sluice", "/bundle/skills/sluice/scripts/statusline-command.sh");
  const contents = await Bun.file(SETTINGS).json();
  expect(contents.statusLine.command).toBe('bash "$HOME/.claude/mine.sh"');
});

test("unwireStatusLine on a settings file with no statusline is a no-op", async () => {
  await Bun.write(SETTINGS, JSON.stringify({ effortLevel: "high" }));
  await unwireStatusLine(SETTINGS, "sluice", "/bundle/skills/sluice/scripts/statusline-command.sh");
  const contents = await Bun.file(SETTINGS).json();
  expect(contents.effortLevel).toBe("high");
});

// A path carrying an apostrophe would otherwise close the shell literal early
// and take the whole command down with it.
test("wireStatusLine quotes a path containing an apostrophe", async () => {
  await wireStatusLine(SETTINGS, "sluice", "/it's/scripts/statusline-command.sh");
  const contents = await Bun.file(SETTINGS).json();
  const proc = Bun.spawnSync(["bash", "-n", "-c", contents.statusLine.command]);
  expect(proc.exitCode).toBe(0);
});

// Wiring through the adapter, not the helper: the gate on global activation and
// the bundle-relative path resolution are what a session-mode install depends
// on, and neither is visible from wireStatusLine on its own.
const STATUSLINE_MANIFEST: SkillManifest = {
  name: "sluice",
  version: "0.19.0",
  description: "d",
  author: "a",
  type: "prompt",
  tools: ["claude"],
  files: { prompt: "SKILL.md" },
  bundle: { include: ["scripts"] },
  install: { claude: { prompt: ".claude/skills/sluice/SKILL.md", bundleRoot: ".claude/skills/sluice" } },
  activation: {
    modes: ["session", "global"],
    default: "global",
    claudeStatuslineScript: "scripts/statusline-command.sh",
  },
};

test("a global install claims an empty statusline slot", async () => {
  await claudeAdapter.install(TMP, STATUSLINE_MANIFEST, new Map(), "global");
  const contents = await Bun.file(join(TMP, ".claude/settings.json")).json();
  expect(contents.statusLine.command).toContain(
    join(TMP, ".claude/skills/sluice/scripts/statusline-command.sh")
  );
});

test("a session install claims nothing", async () => {
  await claudeAdapter.install(TMP, STATUSLINE_MANIFEST, new Map(), "session");
  expect(existsSync(join(TMP, ".claude/settings.json"))).toBe(false);
});

test("removal gives back a slot the install claimed", async () => {
  await claudeAdapter.install(TMP, STATUSLINE_MANIFEST, new Map(), "global");
  await claudeAdapter.remove(TMP, STATUSLINE_MANIFEST, []);
  const contents = await Bun.file(join(TMP, ".claude/settings.json")).json();
  expect(contents.statusLine).toBeUndefined();
});

// Every other command this adapter writes is guarded by its own existence, and
// the reason is in the comment on the SessionStart one: a bundle that moved
// leaves the hook exiting 0 rather than 127. The statusline is the command that
// runs on every keystroke, so it is the last one that should go unguarded.
test("the statusline command is guarded by the script existing", async () => {
  await wireStatusLine(SETTINGS, "sluice", "/gone/skills/sluice/scripts/statusline-command.sh");
  const { command } = (await Bun.file(SETTINGS).json()).statusLine;
  const proc = Bun.spawnSync(["bash", "-c", command]);
  expect(proc.exitCode).toBe(0);
  expect(proc.stderr.toString()).toBe("");
});

// "statusLine": null is a live way to have the key present and the feature off.
// Read as occupied it would leave the slot unusable and unclaimable for good.
test("a null statusline counts as an empty slot", async () => {
  await Bun.write(SETTINGS, JSON.stringify({ statusLine: null }));
  await wireStatusLine(SETTINGS, "sluice", "/bundle/skills/sluice/scripts/statusline-command.sh");
  expect((await Bun.file(SETTINGS).json()).statusLine.command).toContain("/bundle/skills/sluice");
});

// A command that merely CONTAINS ours still belongs to whoever composed it, and
// overwriting it destroys the other half.
test("a command with ours composed into it is left whole", async () => {
  const theirs = `bash ~/prompt.sh; bash '/x/skills/sluice/scripts/statusline-command.sh'`;
  await Bun.write(SETTINGS, JSON.stringify({ statusLine: { type: "command", command: theirs } }));

  await wireStatusLine(SETTINGS, "sluice", "/x/skills/sluice/scripts/statusline-command.sh");
  expect((await Bun.file(SETTINGS).json()).statusLine.command).toBe(theirs);

  await unwireStatusLine(SETTINGS, "sluice", "/x/skills/sluice/scripts/statusline-command.sh");
  expect((await Bun.file(SETTINGS).json()).statusLine.command).toBe(theirs);
});

// The slot is one slot. Ownership keyed off a constant rather than the skill
// installing would let the second skill to declare the field take the first
// one's statusline on install and delete it on removal.
test("another skill neither claims nor removes this skill's statusline", async () => {
  await wireStatusLine(SETTINGS, "sluice", "/x/skills/sluice/scripts/statusline-command.sh");
  const ours = (await Bun.file(SETTINGS).json()).statusLine.command;

  await wireStatusLine(SETTINGS, "terse", "/x/skills/terse/scripts/statusline-command.sh");
  expect((await Bun.file(SETTINGS).json()).statusLine.command).toBe(ours);

  await unwireStatusLine(SETTINGS, "terse", "/x/skills/terse/scripts/statusline-command.sh");
  expect((await Bun.file(SETTINGS).json()).statusLine.command).toBe(ours);
});

// An apostrophe in the path would end the shell literal early and take the
// command down with it. Proved by running the command and seeing the real
// script execute, rather than by reading the quoting back and agreeing with it.
test("wireStatusLine writes a command that runs the script it was given", async () => {
  const dir = join(TMP, "it's", "skills", "sluice", "scripts");
  mkdirSync(dir, { recursive: true });
  const script = join(dir, "statusline-command.sh");
  await Bun.write(script, "#!/usr/bin/env bash\necho RAN\n");

  await wireStatusLine(SETTINGS, "sluice", script);
  const { command } = (await Bun.file(SETTINGS).json()).statusLine;
  const proc = Bun.spawnSync(["bash", "-c", command]);
  expect(proc.stdout.toString().trim()).toBe("RAN");
  expect(proc.exitCode).toBe(0);
});

// Removal without the manifest still knows the skill's name, and the slot names
// the skill, so there is nothing stopping this path from giving it back.
test("removal without a manifest still gives the slot back", async () => {
  await wireStatusLine(SETTINGS, "sluice", "/x/skills/sluice/scripts/statusline-command.sh");
  await unwireStatusLine(SETTINGS, "sluice");
  expect((await Bun.file(SETTINGS).json()).statusLine).toBeUndefined();
});
