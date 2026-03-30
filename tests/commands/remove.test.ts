// tests/commands/remove.test.ts
import { test, expect, beforeEach, afterEach } from "bun:test";
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

test("removeSkill returns error for skill not in lockfile", async () => {
  const result = await removeSkill(TMP, "nonexistent");
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toContain("not installed");
});
