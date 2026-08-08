// tests/commands/remove.test.ts
import { test, expect, beforeEach, afterEach, mock } from "bun:test";
import { removeSkill } from "../../src/cli/commands/remove";
import { installSkill } from "../../src/cli/commands/install";
import { readLockfile } from "../../src/cli/lockfile";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { SkillManifest } from "../../src/cli/types";

const TMP = join(import.meta.dir, ".tmp-remove");

beforeEach(() => {
  mkdirSync(join(TMP, ".claude"), { recursive: true });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

const manifest: SkillManifest = {
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

test("removeSkill deletes installed files and updates lockfile", async () => {
  // First install
  const files = new Map([["SKILL.md", "# Design Review"]]);
  await installSkill(TMP, manifest, files, ["claude"]);

  // Then remove
  const result = await removeSkill(TMP, "design-review");
  expect(result.ok).toBe(true);

  expect(existsSync(join(TMP, ".claude/skills/design-review/SKILL.md"))).toBe(false);

  const lock = await readLockfile(TMP);
  expect(lock.skills["design-review"]).toBeUndefined();
});

// Orphaned-bundle regression: the manifest path built its file list from
// config.prompt and config.supporting only, with no clause for bundleRoot, so
// every bundled file was filtered out before the adapter saw it. Removing a
// skill left its whole references/ and scripts/ tree on disk, including
// executables, and the next install layered a new version on top of it.
const bundleManifest: SkillManifest = {
  name: "sluice",
  version: "0.1.1",
  description: "Routes work by change shape",
  author: "iceinvein",
  type: "prompt",
  tools: ["claude"],
  files: { prompt: "SKILL.md" },
  bundle: { include: ["references", "scripts"] },
  install: {
    claude: {
      prompt: ".claude/skills/sluice/SKILL.md",
      bundleRoot: ".claude/skills/sluice",
    },
  },
};

function mockManifestFetch(manifest: SkillManifest) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock(async () => new Response(JSON.stringify(manifest), { status: 200 })) as any;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test("removeSkill deletes bundled files, not just the prompt", async () => {
  const files = new Map([
    ["SKILL.md", "# Sluice"],
    ["references/meter.md", "# Meter the run"],
    ["references/finish.md", "# Finish"],
    ["scripts/run-stats.sh", "#!/usr/bin/env bash\necho hi\n"],
  ]);
  await installSkill(TMP, bundleManifest, files, ["claude"]);

  // Everything landed, so the removal below is testing removal.
  for (const rel of files.keys()) {
    expect(existsSync(join(TMP, ".claude/skills/sluice", rel))).toBe(true);
  }

  const restoreFetch = mockManifestFetch(bundleManifest);
  try {
    const result = await removeSkill(TMP, "sluice");
    expect(result.ok).toBe(true);

    for (const rel of files.keys()) {
      expect(existsSync(join(TMP, ".claude/skills/sluice", rel))).toBe(false);
    }
    // No empty shell left behind for the next install to layer on top of.
    expect(existsSync(join(TMP, ".claude/skills/sluice"))).toBe(false);
  } finally {
    restoreFetch();
  }
});

test("removeSkill returns error for skill not in lockfile", async () => {
  const result = await removeSkill(TMP, "nonexistent");
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toContain("not installed");
});

// Data-loss regression: when fetchSkillManifest fails (offline, or the skill
// was never published to the GitHub master branch), the fallback path used to
// unlinkSync every file the lockfile listed, including .claude/settings.json.
// For any skill installed with global activation (or MCP servers), that file
// is shared with every other skill and with the user's own hooks and
// permissions, so deleting it destroyed configuration this skill never owned.
const globalHookManifest: SkillManifest = {
  name: "terse",
  version: "1.2.1",
  description: "x",
  author: "iceinvein",
  type: "prompt",
  tools: ["claude"],
  files: { prompt: "SKILL.md" },
  install: {
    claude: { prompt: ".claude/skills/terse/SKILL.md" },
  },
  activation: {
    modes: ["session", "global"],
    default: "session",
    claudeHookDirective: "Activate terse skill at tight level for this session.",
  },
};

async function installWithUnrelatedSettings(): Promise<string> {
  const files = new Map([["SKILL.md", "# Terse"]]);
  await installSkill(TMP, globalHookManifest, files, ["claude"], "global");

  const settingsPath = join(TMP, ".claude/settings.json");
  const settings = await Bun.file(settingsPath).json();
  settings.permissions = { allow: ["Bash(git *)"] };
  settings.env = { SOME_VAR: "1" };
  settings.hooks.PreToolUse = [{ hooks: [{ type: "command", command: "echo unrelated-pretooluse" }] }];
  settings.mcpServers = { "unrelated-server": { command: "npx", args: ["-y", "unrelated"] } };
  await Bun.write(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  return settingsPath;
}

function mockManifestFetchFailure() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock(async () => new Response("Not Found", { status: 404 })) as any;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test("fallback remove path preserves settings.json while dropping the skill's own hook", async () => {
  const settingsPath = await installWithUnrelatedSettings();
  const restoreFetch = mockManifestFetchFailure();

  try {
    const result = await removeSkill(TMP, "terse");
    expect(result.ok).toBe(true);

    // Never deleted outright.
    expect(existsSync(settingsPath)).toBe(true);

    const settings = await Bun.file(settingsPath).json();
    // Unrelated configuration survives untouched.
    expect(settings.permissions).toEqual({ allow: ["Bash(git *)"] });
    expect(settings.env).toEqual({ SOME_VAR: "1" });
    expect(settings.hooks.PreToolUse[0].hooks[0].command).toBe("echo unrelated-pretooluse");
    expect(settings.mcpServers["unrelated-server"]).toBeDefined();

    // The skill's own SessionStart hook is gone.
    const sessionStart = settings.hooks.SessionStart ?? [];
    const stillPresent = sessionStart.some((group: any) =>
      (group.hooks ?? []).some((h: any) => h.command.includes("Activate terse skill"))
    );
    expect(stillPresent).toBe(false);
  } finally {
    restoreFetch();
  }
});

test("fallback remove path still removes a skill-owned prompt file", async () => {
  await installWithUnrelatedSettings();
  const restoreFetch = mockManifestFetchFailure();

  try {
    const result = await removeSkill(TMP, "terse");
    expect(result.ok).toBe(true);
    expect(existsSync(join(TMP, ".claude/skills/terse/SKILL.md"))).toBe(false);

    const lock = await readLockfile(TMP);
    expect(lock.skills["terse"]).toBeUndefined();
  } finally {
    restoreFetch();
  }
});
