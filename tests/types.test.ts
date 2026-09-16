import { test, expect } from "bun:test";
import { validateManifest, ACTIVATION_MODES } from "../src/cli/types";

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

test("ACTIVATION_MODES contains session and global", () => {
  expect(ACTIVATION_MODES).toEqual(["session", "global"]);
});

test("validateManifest accepts manifest with activation block", () => {
  const data = {
    name: "terse",
    version: "1.0.0",
    description: "x",
    author: "a",
    type: "prompt",
    tools: ["claude"],
    install: { claude: { prompt: ".claude/skills/terse/SKILL.md" } },
    activation: {
      modes: ["session", "global"],
      default: "session",
      claudeHookDirective: "Activate terse skill at tight level for this session.",
    },
  };
  const result = validateManifest(data);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.manifest.activation?.modes).toEqual(["session", "global"]);
    expect(result.manifest.activation?.default).toBe("session");
  }
});

test("validateManifest rejects activation with unknown mode", () => {
  const data = {
    name: "terse",
    version: "1.0.0",
    description: "x",
    author: "a",
    type: "prompt",
    tools: ["claude"],
    install: { claude: { prompt: ".claude/skills/terse/SKILL.md" } },
    activation: { modes: ["always"], default: "always" },
  };
  const result = validateManifest(data);
  expect(result.ok).toBe(false);
});

test("validateManifest rejects activation with default not in modes", () => {
  const data = {
    name: "terse",
    version: "1.0.0",
    description: "x",
    author: "a",
    type: "prompt",
    tools: ["claude"],
    install: { claude: { prompt: ".claude/skills/terse/SKILL.md" } },
    activation: { modes: ["session"], default: "global" },
  };
  const result = validateManifest(data);
  expect(result.ok).toBe(false);
});

test("validateManifest accepts manifest without activation block", () => {
  const data = {
    name: "foo",
    version: "1.0.0",
    description: "x",
    author: "a",
    type: "prompt",
    tools: ["claude"],
    install: { claude: { prompt: ".claude/skills/foo/SKILL.md" } },
  };
  const result = validateManifest(data);
  expect(result.ok).toBe(true);
});

test("validateManifest rejects a non-string activation.claudeHookScript", () => {
  const result = validateManifest({
    name: "sluice",
    version: "1.0.0",
    description: "x",
    author: "a",
    type: "prompt",
    tools: ["claude"],
    install: { claude: { prompt: ".claude/skills/sluice/SKILL.md" } },
    activation: { modes: ["global"], default: "global", claudeHookScript: 3 },
  });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toContain("claudeHookScript");
});

test("validateManifest rejects a non-string activation.claudeStopScript", () => {
  const result = validateManifest({
    name: "sluice",
    version: "1.0.0",
    description: "x",
    author: "a",
    type: "prompt",
    tools: ["claude"],
    install: { claude: { prompt: ".claude/skills/sluice/SKILL.md" } },
    activation: { modes: ["global"], default: "global", claudeStopScript: 3 },
  });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toContain("claudeStopScript");
});

test("validateManifest rejects a non-string activation.claudeStatuslineScript", () => {
  const result = validateManifest({
    name: "sluice",
    version: "1.0.0",
    description: "x",
    author: "a",
    type: "prompt",
    tools: ["claude"],
    install: { claude: { prompt: ".claude/skills/sluice/SKILL.md", bundleRoot: ".claude/skills/sluice" } },
    activation: { modes: ["global"], default: "global", claudeStatuslineScript: 3 },
  });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toContain("claudeStatuslineScript");
});

// Every one of these three is a bundle-relative path, and the install resolves
// it against bundleRoot. Without one the manifest validates clean and then
// wires nothing at all, which is the silent no-op this rejects instead.
for (const field of ["claudeHookScript", "claudeStopScript", "claudeStatuslineScript"]) {
  test(`validateManifest rejects activation.${field} with no install.claude.bundleRoot`, () => {
    const result = validateManifest({
      name: "sluice",
      version: "1.0.0",
      description: "x",
      author: "a",
      type: "prompt",
      tools: ["claude"],
      install: { claude: { prompt: ".claude/skills/sluice/SKILL.md" } },
      activation: { modes: ["global"], default: "global", [field]: "scripts/x.sh" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain(field);
      expect(result.error).toContain("bundleRoot");
    }
  });

  test(`validateManifest accepts activation.${field} alongside a bundleRoot`, () => {
    const result = validateManifest({
      name: "sluice",
      version: "1.0.0",
      description: "x",
      author: "a",
      type: "prompt",
      tools: ["claude"],
      install: {
        claude: { prompt: ".claude/skills/sluice/SKILL.md", bundleRoot: ".claude/skills/sluice" },
      },
      activation: { modes: ["global"], default: "global", [field]: "scripts/x.sh" },
    });
    expect(result.ok).toBe(true);
  });
}

// A directive on its own needs no bundle: the hook echoes it and runs nothing.
test("validateManifest accepts a bare claudeHookDirective with no bundleRoot", () => {
  const result = validateManifest({
    name: "terse",
    version: "1.0.0",
    description: "x",
    author: "a",
    type: "prompt",
    tools: ["claude"],
    install: { claude: { prompt: ".claude/skills/terse/SKILL.md" } },
    activation: { modes: ["global"], default: "global", claudeHookDirective: "Activate terse." },
  });
  expect(result.ok).toBe(true);
});
