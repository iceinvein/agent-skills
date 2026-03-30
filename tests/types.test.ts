import { test, expect } from "bun:test";
import { validateManifest } from "../src/cli/types";

test("validateManifest accepts valid prompt skill", () => {
  const manifest = {
    name: "test-skill",
    version: "1.0.0",
    description: "A test skill",
    author: "iceinvein",
    type: "prompt" as const,
    tools: ["claude" as const],
    files: { prompt: "SKILL.md" },
    install: {
      claude: { prompt: ".claude/skills/test-skill/SKILL.md" },
    },
  };
  expect(validateManifest(manifest)).toEqual({ ok: true, manifest });
});

test("validateManifest accepts valid code skill", () => {
  const manifest = {
    name: "code-intel",
    version: "1.0.0",
    description: "MCP server",
    author: "iceinvein",
    type: "code" as const,
    tools: ["claude" as const, "cursor" as const],
    mcp: {
      package: "@iceinvein/code-intelligence-mcp",
      command: "npx",
      args: ["-y", "@iceinvein/code-intelligence-mcp"],
    },
    install: {
      claude: {
        mcpServers: {
          "code-intel": { command: "npx", args: ["-y", "@iceinvein/code-intelligence-mcp"] },
        },
      },
      cursor: {
        mcpServers: {
          "code-intel": { command: "npx", args: ["-y", "@iceinvein/code-intelligence-mcp"] },
        },
      },
    },
  };
  expect(validateManifest(manifest)).toEqual({ ok: true, manifest });
});

test("validateManifest rejects manifest missing name", () => {
  const manifest = { version: "1.0.0", description: "x", author: "x", type: "prompt", tools: ["claude"], install: {} };
  const result = validateManifest(manifest as any);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toContain("name");
});

test("validateManifest rejects manifest with invalid type", () => {
  const manifest = { name: "x", version: "1.0.0", description: "x", author: "x", type: "invalid", tools: ["claude"], install: {} };
  const result = validateManifest(manifest as any);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toContain("type");
});

test("validateManifest rejects manifest with invalid tool", () => {
  const manifest = { name: "x", version: "1.0.0", description: "x", author: "x", type: "prompt", tools: ["vscode"], install: {} };
  const result = validateManifest(manifest as any);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toContain("tool");
});
