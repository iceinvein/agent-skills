import { test, expect, beforeEach, afterEach } from "bun:test";
import { wireSessionStartHook, unwireSessionStartHook } from "../../src/cli/adapters/claude";
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
