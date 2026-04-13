import { test, expect, beforeEach, afterEach } from "bun:test";
import { claudeAdapter, wireSessionStartHook, unwireSessionStartHook } from "../../src/cli/adapters/claude";
import type { SkillManifest } from "../../src/cli/types";
import { mkdirSync, rmSync, existsSync } from "node:fs";
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
