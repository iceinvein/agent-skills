import { test, expect, beforeEach, afterEach } from "bun:test";
import { codexAdapter } from "../../src/cli/adapters/codex";
import { mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SkillManifest } from "../../src/cli/types";

const TMP = join(import.meta.dir, ".tmp-codex");

beforeEach(() => {
  mkdirSync(TMP, { recursive: true });
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
  tools: ["codex"],
  files: { prompt: "SKILL.md" },
  install: {
    codex: { prompt: "AGENTS.md", append: true },
  },
};

const mcpManifest: SkillManifest = {
  name: "code-intelligence",
  version: "1.0.0",
  description: "MCP server",
  author: "iceinvein",
  type: "code",
  tools: ["codex"],
  install: {
    codex: {
      mcpServers: {
        "code-intelligence": {
          command: "npx",
          args: ["-y", "@iceinvein/code-intelligence-mcp"],
        },
      },
    },
  },
};

test("install appends to AGENTS.md with section markers", async () => {
  writeFileSync(join(TMP, "AGENTS.md"), "# Existing Content\n");
  const files = new Map([["SKILL.md", "# Design Review\nDo the review."]]);
  const installed = await codexAdapter.install(TMP, promptManifest, files);

  const content = readFileSync(join(TMP, "AGENTS.md"), "utf-8");
  expect(content).toContain("# Existing Content");
  expect(content).toContain("<!-- agent-skills:start:design-review -->");
  expect(content).toContain("# Design Review\nDo the review.");
  expect(content).toContain("<!-- agent-skills:end:design-review -->");
  expect(installed).toContain("AGENTS.md");
});

test("install creates AGENTS.md if it does not exist", async () => {
  const files = new Map([["SKILL.md", "# Design Review"]]);
  await codexAdapter.install(TMP, promptManifest, files);

  const content = readFileSync(join(TMP, "AGENTS.md"), "utf-8");
  expect(content).toContain("<!-- agent-skills:start:design-review -->");
});

test("install warns and skips MCP for codex", async () => {
  const files = new Map<string, string>();
  const installed = await codexAdapter.install(TMP, mcpManifest, files);
  expect(installed).toEqual([]);
});

test("remove strips section from AGENTS.md", async () => {
  const files = new Map([["SKILL.md", "# Design Review"]]);
  await codexAdapter.install(TMP, promptManifest, files);
  await codexAdapter.remove(TMP, promptManifest, ["AGENTS.md"]);

  const content = readFileSync(join(TMP, "AGENTS.md"), "utf-8");
  expect(content).not.toContain("agent-skills:start:design-review");
  expect(content).not.toContain("# Design Review");
});
