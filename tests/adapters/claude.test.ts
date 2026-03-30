import { test, expect, beforeEach, afterEach } from "bun:test";
import { claudeAdapter } from "../../src/cli/adapters/claude";
import { mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SkillManifest } from "../../src/cli/types";

const TMP = join(import.meta.dir, ".tmp-claude");

beforeEach(() => {
  mkdirSync(join(TMP, ".claude"), { recursive: true });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

const promptManifest: SkillManifest = {
  name: "design-review",
  version: "1.0.0",
  description: "Design review",
  author: "iceinvein",
  type: "prompt",
  tools: ["claude"],
  files: { prompt: "SKILL.md" },
  install: {
    claude: { prompt: ".claude/skills/design-review/SKILL.md" },
  },
};

const mcpManifest: SkillManifest = {
  name: "code-intelligence",
  version: "1.0.0",
  description: "MCP server",
  author: "iceinvein",
  type: "code",
  tools: ["claude"],
  install: {
    claude: {
      mcpServers: {
        "code-intelligence": {
          command: "npx",
          args: ["-y", "@iceinvein/code-intelligence-mcp"],
        },
      },
    },
  },
};

test("install copies prompt file to .claude/skills/", async () => {
  const files = new Map([["SKILL.md", "# Design Review\nContent here"]]);
  const installed = await claudeAdapter.install(TMP, promptManifest, files);

  const content = readFileSync(join(TMP, ".claude/skills/design-review/SKILL.md"), "utf-8");
  expect(content).toBe("# Design Review\nContent here");
  expect(installed).toContain(".claude/skills/design-review/SKILL.md");
});

test("install adds MCP server to .claude/settings.json", async () => {
  const files = new Map<string, string>();
  const installed = await claudeAdapter.install(TMP, mcpManifest, files);

  const settings = JSON.parse(readFileSync(join(TMP, ".claude/settings.json"), "utf-8"));
  expect(settings.mcpServers["code-intelligence"]).toEqual({
    command: "npx",
    args: ["-y", "@iceinvein/code-intelligence-mcp"],
  });
  expect(installed).toContain(".claude/settings.json");
});

test("install merges MCP into existing settings.json", async () => {
  writeFileSync(
    join(TMP, ".claude/settings.json"),
    JSON.stringify({ mcpServers: { existing: { command: "node", args: ["server.js"] } } })
  );

  const files = new Map<string, string>();
  await claudeAdapter.install(TMP, mcpManifest, files);

  const settings = JSON.parse(readFileSync(join(TMP, ".claude/settings.json"), "utf-8"));
  expect(settings.mcpServers.existing).toBeDefined();
  expect(settings.mcpServers["code-intelligence"]).toBeDefined();
});

test("remove deletes prompt files", async () => {
  const files = new Map([["SKILL.md", "# Content"]]);
  await claudeAdapter.install(TMP, promptManifest, files);
  await claudeAdapter.remove(TMP, promptManifest, [".claude/skills/design-review/SKILL.md"]);

  const exists = await Bun.file(join(TMP, ".claude/skills/design-review/SKILL.md")).exists();
  expect(exists).toBe(false);
});

test("remove deletes MCP entry from settings.json", async () => {
  const files = new Map<string, string>();
  await claudeAdapter.install(TMP, mcpManifest, files);
  await claudeAdapter.remove(TMP, mcpManifest, [".claude/settings.json"]);

  const settings = JSON.parse(readFileSync(join(TMP, ".claude/settings.json"), "utf-8"));
  expect(settings.mcpServers["code-intelligence"]).toBeUndefined();
});
