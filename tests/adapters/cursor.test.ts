import { test, expect, beforeEach, afterEach } from "bun:test";
import { cursorAdapter } from "../../src/cli/adapters/cursor";
import { mkdirSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SkillManifest } from "../../src/cli/types";

const TMP = join(import.meta.dir, ".tmp-cursor");

beforeEach(() => {
  mkdirSync(join(TMP, ".cursor"), { recursive: true });
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
  tools: ["cursor"],
  files: { prompt: "SKILL.md" },
  install: {
    cursor: { prompt: ".cursor/rules/design-review.mdc" },
  },
};

const mcpManifest: SkillManifest = {
  name: "code-intelligence",
  version: "1.0.0",
  description: "MCP server",
  author: "iceinvein",
  type: "code",
  tools: ["cursor"],
  install: {
    cursor: {
      mcpServers: {
        "code-intelligence": {
          command: "npx",
          args: ["-y", "@iceinvein/code-intelligence-mcp"],
        },
      },
    },
  },
};

test("install copies prompt file to .cursor/rules/", async () => {
  const files = new Map([["SKILL.md", "# Design Review"]]);
  const installed = await cursorAdapter.install(TMP, promptManifest, files);

  const content = readFileSync(join(TMP, ".cursor/rules/design-review.mdc"), "utf-8");
  expect(content).toBe("# Design Review");
  expect(installed).toContain(".cursor/rules/design-review.mdc");
});

test("install adds MCP server to .cursor/mcp.json", async () => {
  const files = new Map<string, string>();
  const installed = await cursorAdapter.install(TMP, mcpManifest, files);

  const mcp = JSON.parse(readFileSync(join(TMP, ".cursor/mcp.json"), "utf-8"));
  expect(mcp.mcpServers["code-intelligence"]).toEqual({
    command: "npx",
    args: ["-y", "@iceinvein/code-intelligence-mcp"],
  });
  expect(installed).toContain(".cursor/mcp.json");
});

test("remove deletes prompt file", async () => {
  const files = new Map([["SKILL.md", "# Content"]]);
  await cursorAdapter.install(TMP, promptManifest, files);
  await cursorAdapter.remove(TMP, promptManifest, [".cursor/rules/design-review.mdc"]);

  const exists = await Bun.file(join(TMP, ".cursor/rules/design-review.mdc")).exists();
  expect(exists).toBe(false);
});
