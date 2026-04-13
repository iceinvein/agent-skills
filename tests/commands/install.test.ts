// tests/commands/install.test.ts
import { test, expect, beforeEach, afterEach } from "bun:test";
import { installSkill } from "../../src/cli/commands/install";
import { readLockfile } from "../../src/cli/lockfile";
import { mkdirSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";

const TMP = join(import.meta.dir, ".tmp-install");

beforeEach(() => {
  mkdirSync(join(TMP, ".claude"), { recursive: true });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

test("installSkill installs prompt skill to detected tool", async () => {
  const manifest = {
    name: "design-review",
    version: "1.0.0",
    description: "Design review",
    author: "iceinvein",
    type: "prompt" as const,
    tools: ["claude" as const],
    files: { prompt: "SKILL.md" },
    install: {
      claude: { prompt: ".claude/skills/design-review/SKILL.md" },
    },
  };
  const files = new Map([["SKILL.md", "# Design Review"]]);

  const result = await installSkill(TMP, manifest, files, ["claude"]);

  expect(result.ok).toBe(true);
  const content = readFileSync(join(TMP, ".claude/skills/design-review/SKILL.md"), "utf-8");
  expect(content).toBe("# Design Review");

  const lock = await readLockfile(TMP);
  expect(lock.skills["design-review"]).toBeDefined();
  expect(lock.skills["design-review"].tools).toContain("claude");
});

test("installSkill skips tools not in manifest", async () => {
  const manifest = {
    name: "design-review",
    version: "1.0.0",
    description: "Design review",
    author: "iceinvein",
    type: "prompt" as const,
    tools: ["claude" as const],
    files: { prompt: "SKILL.md" },
    install: {
      claude: { prompt: ".claude/skills/design-review/SKILL.md" },
    },
  };
  const files = new Map([["SKILL.md", "# Design Review"]]);

  const result = await installSkill(TMP, manifest, files, ["claude", "cursor"]);

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.installed.claude).toBeDefined();
    expect(result.skipped).toContain("cursor");
  }
});

test("installSkill returns error when no compatible tools", async () => {
  const manifest = {
    name: "design-review",
    version: "1.0.0",
    description: "Design review",
    author: "iceinvein",
    type: "prompt" as const,
    tools: ["cursor" as const],
    files: { prompt: "SKILL.md" },
    install: {
      cursor: { prompt: ".cursor/rules/design-review.mdc" },
    },
  };
  const files = new Map([["SKILL.md", "# Design Review"]]);

  const result = await installSkill(TMP, manifest, files, ["claude"]);

  expect(result.ok).toBe(false);
});

test("installSkill persists activation mode in lockfile and wires hook", async () => {
  const manifest = {
    name: "terse",
    version: "1.0.0",
    description: "Terse",
    author: "iceinvein",
    type: "prompt" as const,
    tools: ["claude" as const],
    files: { prompt: "SKILL.md" },
    install: {
      claude: { prompt: ".claude/skills/terse/SKILL.md" },
    },
    activation: {
      modes: ["session" as const, "global" as const],
      default: "session" as const,
      claudeHookDirective: "Activate terse skill at tight level for this session.",
    },
  };
  const files = new Map([["SKILL.md", "# Terse"]]);

  const result = await installSkill(TMP, manifest, files, ["claude"], "global");
  expect(result.ok).toBe(true);

  const lock = await readLockfile(TMP);
  expect(lock.skills["terse"].activation).toBe("global");

  const settings = await Bun.file(join(TMP, ".claude/settings.json")).json();
  expect(settings.hooks.SessionStart[0].hooks[0].command).toContain("Activate terse skill");
});

test("installSkill omits activation from lockfile when not specified", async () => {
  const manifest = {
    name: "terse",
    version: "1.0.0",
    description: "Terse",
    author: "iceinvein",
    type: "prompt" as const,
    tools: ["claude" as const],
    files: { prompt: "SKILL.md" },
    install: {
      claude: { prompt: ".claude/skills/terse/SKILL.md" },
    },
    activation: {
      modes: ["session" as const, "global" as const],
      default: "session" as const,
      claudeHookDirective: "Activate terse skill at tight level for this session.",
    },
  };
  const files = new Map([["SKILL.md", "# Terse"]]);

  const result = await installSkill(TMP, manifest, files, ["claude"]);
  expect(result.ok).toBe(true);

  const lock = await readLockfile(TMP);
  expect(lock.skills["terse"].activation).toBeUndefined();
});
